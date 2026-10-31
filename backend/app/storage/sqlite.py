"""Durable hackathon adapter: JSON DTO rows plus relational keys/constraints.

A short BEGIN IMMEDIATE serializes state-dependent decisions across processes.
No transaction may span an AI/network await. Data size is intentionally small;
this adapter loads staged rows for shared repository logic, not large-scale OLTP.
"""
from copy import deepcopy
import json
import os
from pathlib import Path
import sqlite3
from threading import local
from types import SimpleNamespace

from app.clock import stamp, utc_now
from app.models import Context, Draft, Offer, Policy
from app.storage.fixtures import validate_dataset
from app.storage.interfaces import DuplicateRecord, RevisionConflict, StorageUnavailable
from app.storage.records import AuditRecord, IdempotencyRecord, OutboxRecord, ReviewRecord, TurnSnapshot, hash_json
from app.storage.repositories import State, Contexts, Drafts, Reviews, Deliveries, Audit, Idempotency, Turns

SCHEMA_VERSION = '1'
TABLES = (
    ('contexts', 'contexts', Context, lambda row: row.customer.customer_id),
    ('drafts', 'drafts', Draft, lambda row: row.draft_id),
    ('reviews', 'reviews', ReviewRecord, lambda row: row.review_id),
    ('outbox', 'deliveries', OutboxRecord, lambda row: row.delivery_id),
    ('audit', 'audit', AuditRecord, lambda row: row.audit_id),
    ('idempotency', 'idempotency', IdempotencyRecord, lambda row: row.scope.storage_key()),
    ('turns', 'turns', TurnSnapshot, lambda row: row.request.turn_id),
)
KEY_COLUMNS = {'contexts': 'customer_id', 'drafts': 'draft_id', 'reviews': 'review_id', 'outbox': 'delivery_id', 'audit': 'audit_id', 'idempotency': 'scope_key', 'turns': 'turn_id'}
APPEND_ONLY = {'reviews', 'outbox', 'audit'}


def database_key(key):
    return json.dumps(key, separators=(',', ':')) if isinstance(key, tuple) else key


def columns(table, record):
    payload = record.model_dump_json()
    if table == 'contexts':
        # Offers are assembled from the normalized master catalogue/relationship rows.
        body = record.model_dump(mode='json')
        body.pop('offers')
        return {'customer_id': record.customer.customer_id, 'payload_json': json.dumps(body, ensure_ascii=False, separators=(',', ':'))}
    if table == 'drafts':
        return {'draft_id': record.draft_id, 'customer_id': record.customer_id, 'revision': record.revision, 'status': record.status, 'payload_json': payload}
    if table == 'reviews':
        return {'review_id': record.review_id, 'draft_id': record.draft_id, 'revision': record.revision, 'payload_json': payload}
    if table == 'outbox':
        return {'delivery_id': record.delivery_id, 'draft_id': record.draft_id, 'customer_id': record.customer_id, 'campaign_key': record.campaign_key, 'content_hash': record.content_hash, 'sent_at': record.sent_at, 'payload_json': payload}
    if table == 'audit':
        return {'audit_id': record.audit_id, 'draft_id': record.draft.draft_id, 'occurred_at': record.occurred_at, 'payload_json': payload}
    if table == 'idempotency':
        return {'scope_key': database_key(record.scope.storage_key()), 'actor_id': record.scope.actor_id, 'method': record.scope.method, 'path': record.scope.path, 'operation_key': record.scope.key, 'expires_at': record.expires_at, 'payload_json': payload}
    if table == 'turns':
        return {'turn_id': record.request.turn_id, 'customer_id': record.request.customer_id, 'expires_at': record.expires_at, 'payload_json': payload}
    raise ValueError('Unknown internal storage table')


def insert_row(connection, table, record):
    row = columns(table, record)
    names = list(row)
    # Table/column identifiers come exclusively from constants above.
    connection.execute('INSERT INTO ' + table + ' (' + ','.join(names) + ') VALUES (' + ','.join('?' for _ in names) + ')', tuple(row[name] for name in names))


class SQLiteStorage:
    def __init__(self, path, clock=utc_now):
        self.path = Path(path).resolve()
        self.clock = clock
        self.local = local()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        try:
            fd = os.open(self.path, os.O_RDWR | os.O_CREAT | os.O_EXCL, 0o600)
        except FileExistsError:
            pass
        else:
            os.close(fd)
        self.initialize_schema()

    def connect(self):
        try:
            connection = sqlite3.connect(str(self.path), timeout=5, isolation_level=None)
            connection.execute('PRAGMA foreign_keys=ON')
            connection.execute('PRAGMA busy_timeout=5000')
            return connection
        except sqlite3.Error:
            raise StorageUnavailable('Persistent storage is unavailable') from None

    def initialize_schema(self):
        connection = self.connect()
        try:
            existing = {row[0] for row in connection.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")}
            if existing and 'metadata' not in existing:
                raise StorageUnavailable('Selected file is not a CodeVortex database')
            connection.execute('PRAGMA journal_mode=WAL')
            connection.execute('BEGIN IMMEDIATE')
            if 'metadata' in existing:
                row = connection.execute("SELECT value FROM metadata WHERE key='schema_version'").fetchone()
                if row is None or row[0] != SCHEMA_VERSION:
                    raise StorageUnavailable('Database schema version requires an explicit migration')
            for statement in (Path(__file__).with_name('schema.sql')).read_text().split(';'):
                if statement.strip():
                    connection.execute(statement)
            connection.execute("INSERT INTO metadata(key,value) VALUES('schema_version',?) ON CONFLICT(key) DO NOTHING", (SCHEMA_VERSION,))
            connection.commit()
        except sqlite3.Error:
            connection.rollback()
            raise StorageUnavailable('Cannot initialize persistent storage') from None
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def seeded(self):
        connection = self.connect()
        try:
            return connection.execute("SELECT value FROM metadata WHERE key='seeded_at'").fetchone() is not None
        finally:
            connection.close()

    def seed(self, dataset, drafts=()):
        validate_dataset(dataset)
        connection = self.connect()
        try:
            connection.execute('BEGIN IMMEDIATE')
            if connection.execute("SELECT value FROM metadata WHERE key='seeded_at'").fetchone() is not None:
                connection.rollback()
                return False
            if connection.execute('SELECT customer_id FROM contexts LIMIT 1').fetchone() is not None:
                raise StorageUnavailable('Unmarked database already has records; refusing to overwrite')
            catalogue = {offer.offer_id: offer for context in dataset.customers for offer in context.offers}
            for offer in catalogue.values():
                connection.execute('INSERT INTO offers(offer_id,terms_version,payload_json) VALUES(?,?,?)', (offer.offer_id, offer.terms_version, offer.model_dump_json()))
            for context in dataset.customers:
                insert_row(connection, 'contexts', context)
                for position, offer in enumerate(context.offers):
                    connection.execute('INSERT INTO customer_offers(customer_id,offer_id,position) VALUES(?,?,?)', (context.customer.customer_id, offer.offer_id, position))
            connection.execute('INSERT INTO policy(singleton_id,payload_json) VALUES(1,?)', (dataset.policy.model_dump_json(),))
            state = State(contexts={row.customer.customer_id: row for row in dataset.customers}, policy=dataset.policy)
            # Use the same integrity checks as later draft inserts before seeding.
            draft_repository = Drafts(SimpleNamespace(closed=False, staged=state))
            for draft in drafts:
                draft_repository.add(draft)
                insert_row(connection, 'drafts', draft)
            connection.executemany('INSERT INTO metadata(key,value) VALUES(?,?)', [('seeded_at', stamp(self.clock())), ('seed_sha256', hash_json(dataset.model_dump(mode='json'))), ('seed_customer_count', str(len(dataset.customers)))])
            connection.commit()
            return True
        except sqlite3.IntegrityError:
            connection.rollback()
            raise DuplicateRecord('Seed data violates database relationships or uniqueness') from None
        except sqlite3.Error:
            connection.rollback()
            raise StorageUnavailable('Cannot initialize dataset records') from None
        except BaseException:
            connection.rollback()
            raise
        finally:
            connection.close()

    def load_state(self, connection):
        row = connection.execute('SELECT payload_json FROM policy WHERE singleton_id=1').fetchone()
        if row is None:
            raise StorageUnavailable('Database has not been seeded')
        state = State(contexts={}, policy=Policy.model_validate_json(row[0]))
        catalogue = {key: Offer.model_validate_json(value) for key, value in connection.execute('SELECT offer_id,payload_json FROM offers')}
        assigned = {}
        for customer_id, offer_id in connection.execute('SELECT customer_id,offer_id FROM customer_offers ORDER BY customer_id,position'):
            assigned.setdefault(customer_id, []).append(catalogue[offer_id].model_dump(mode='json'))
        for table, attribute, model, identity in TABLES:
            result = getattr(state, attribute)
            for value, in connection.execute('SELECT payload_json FROM ' + table):
                if table == 'contexts':
                    body = json.loads(value)
                    body['offers'] = assigned.get(body['customer']['customer_id'], [])
                    record = Context.model_validate(body)
                else:
                    record = model.model_validate_json(value)
                result[identity(record)] = record
        return state

    def persist(self, connection, before, after):
        if before.policy.model_dump() != after.policy.model_dump():
            raise RevisionConflict('Policy updates require an explicit versioned import')
        for table, attribute, _, _ in TABLES:
            old, new = getattr(before, attribute), getattr(after, attribute)
            key_column = KEY_COLUMNS[table]
            for key in old.keys() - new.keys():
                if table in APPEND_ONLY or table in ('contexts', 'drafts'):
                    raise RevisionConflict('Business records cannot be deleted by this adapter')
                connection.execute('DELETE FROM ' + table + ' WHERE ' + key_column + '=?', (database_key(key),))
            for key, record in new.items():
                previous = old.get(key)
                if previous is not None and previous.model_dump() == record.model_dump():
                    continue
                if previous is None:
                    insert_row(connection, table, record)
                    continue
                if table == 'contexts' and [offer.model_dump() for offer in previous.offers] != [offer.model_dump() for offer in record.offers]:
                    raise RevisionConflict('Offer catalogue changes require an explicit versioned import')
                if table in APPEND_ONLY:
                    raise RevisionConflict('Audit, review and outbox records are append-only')
                row = columns(table, record)
                fields = [field for field in row if field != key_column]
                statement = 'UPDATE ' + table + ' SET ' + ','.join(field + '=?' for field in fields) + ' WHERE ' + key_column + '=?'
                values = [row[field] for field in fields] + [database_key(key)]
                if table == 'drafts':
                    statement += ' AND revision=?'
                    values.append(previous.revision)
                if connection.execute(statement, tuple(values)).rowcount != 1:
                    raise RevisionConflict('Stored record changed during the transaction')

    def unit_of_work(self):
        return SQLiteUnitOfWork(self)


class SQLiteUnitOfWork:
    def __init__(self, store):
        self.store = store
        self.closed, self.entered, self.committed = True, False, False

    def __enter__(self):
        if self.entered or getattr(self.store.local, 'active', False):
            raise RuntimeError('Nested or reused units of work are not supported')
        self.connection = self.store.connect()
        try:
            self.connection.execute('BEGIN IMMEDIATE')
            self.staged = self.store.load_state(self.connection)
            self.before = deepcopy(self.staged)
            self.closed, self.entered = False, True
            self.store.local.active = True
            self.turns, self.contexts, self.drafts = Turns(self), Contexts(self), Drafts(self)
            self.reviews, self.deliveries = Reviews(self), Deliveries(self)
            self.audit, self.idempotency = Audit(self), Idempotency(self)
            return self
        except BaseException as error:
            self.closed = True
            self.store.local.active = False
            self.connection.rollback()
            self.connection.close()
            if isinstance(error, (sqlite3.Error, ValueError)):
                raise StorageUnavailable('Database is busy or unavailable') from None
            raise

    def commit(self):
        if self.closed:
            raise RuntimeError('Unit of work is closed')
        self.committed = True

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            if exc_type is None and self.committed:
                self.store.persist(self.connection, self.before, self.staged)
                self.connection.commit()
            else:
                self.connection.rollback()
        except sqlite3.IntegrityError:
            self.connection.rollback()
            raise DuplicateRecord('Database uniqueness or relationship conflict') from None
        except sqlite3.Error:
            self.connection.rollback()
            raise StorageUnavailable('Cannot commit persistent storage') from None
        except BaseException:
            self.connection.rollback()
            raise
        finally:
            self.closed = True
            self.store.local.active = False
            self.connection.close()
        return False
