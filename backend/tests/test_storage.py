import copy
import json
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from pathlib import Path
from threading import Barrier

import pytest
from fastapi.testclient import TestClient

from app.main import create_app
from app.models import Draft, ReviewRequest
from app.storage.fixtures import FixtureError, load_fixtures
from app.storage.interfaces import DuplicateRecord, IdempotencyConflict, MissingRecord, OperationInProgress, RevisionConflict
from app.storage.memory import MemoryStorage
from app.storage.records import AuditRecord, IdempotencyScope, OutboxRecord, ReviewRecord, hash_json, message_hash

ROOT = Path(__file__).resolve().parents[1]


@pytest.fixture
def seed():
    return load_fixtures(ROOT / 'fixtures/dataset.json', ROOT / 'fixtures/drafts.json')


@pytest.fixture
def store(seed):
    return MemoryStorage(*seed)


def initial(store):
    with store.unit_of_work() as uow:
        return uow.drafts.get('DRAFT001')


def next_draft(draft, **changes):
    data = draft.model_dump()
    data.update(revision=draft.revision + 1, updated_at='2026-10-31T06:01:00Z')
    data.update(changes)
    return Draft.model_validate(data)


def scope(**changes):
    data = {'actor_id': 'REVIEWER001', 'method': 'POST', 'path': '/api/v1/drafts', 'key': 'create_001'}
    data.update(changes)
    return IdempotencyScope.model_validate(data)


def test_reads_are_deep_copies_and_labels_stay_outside_storage(store, seed):
    with store.unit_of_work() as uow:
        context = uow.contexts.get('CUST001')
        context.customer.display_name = 'Changed'
        context.offers[0].terms = 'Changed'
        policy = uow.contexts.get_policy()
        policy.templates[0].body = 'Changed'
        draft = uow.drafts.get('DRAFT001')
        draft.message.subject = 'Changed'
        uow.commit()
    with store.unit_of_work() as uow:
        assert uow.contexts.get('CUST001').customer.display_name == 'Asha'
        assert uow.contexts.get('CUST001').offers[0].terms != 'Changed'
        assert uow.contexts.get_policy().templates[0].body != 'Changed'
        assert uow.drafts.get('DRAFT001').message.subject != 'Changed'
    assert not hasattr(store.state, 'labels')
    seed[0].customers[0].customer.display_name = 'External mutation'
    with store.unit_of_work() as uow:
        assert uow.contexts.get('CUST001').customer.display_name == 'Asha'


def test_rollback_is_default_and_exception_overrides_commit(store):
    draft = initial(store).model_copy(update={'draft_id': 'DRAFT002'}, deep=True)
    with store.unit_of_work() as uow:
        uow.drafts.add(draft)
    with store.unit_of_work() as uow:
        with pytest.raises(MissingRecord):
            uow.drafts.get('DRAFT002')
    with pytest.raises(RuntimeError):
        with store.unit_of_work() as uow:
            uow.drafts.add(draft)
            uow.commit()
            raise RuntimeError('Simulated audit/storage failure')
    with store.unit_of_work() as uow:
        with pytest.raises(MissingRecord):
            uow.drafts.get('DRAFT002')
    with store.unit_of_work() as uow:
        uow.drafts.add(draft)
        uow.commit()
    draft.message.body = 'External mutation'
    with store.unit_of_work() as uow:
        assert uow.drafts.get('DRAFT002').message.body != 'External mutation'
        with pytest.raises(DuplicateRecord):
            uow.drafts.add(uow.drafts.get('DRAFT002'))


def test_revision_cas_and_terminal_states(store):
    draft = initial(store)
    rejected = next_draft(draft, status='rejected')
    with store.unit_of_work() as uow:
        uow.drafts.replace(rejected, expected_revision=1)
        uow.commit()
    with store.unit_of_work() as uow:
        with pytest.raises(RevisionConflict):
            uow.drafts.replace(rejected, expected_revision=1)
        with pytest.raises(RevisionConflict):
            uow.drafts.replace(next_draft(rejected), expected_revision=2)


def test_concurrent_updates_have_one_winner(store):
    draft = initial(store)
    barrier = Barrier(2)

    def attempt(feedback):
        changed = next_draft(draft, feedback=feedback)
        barrier.wait(timeout=5)
        try:
            with store.unit_of_work() as uow:
                uow.drafts.replace(changed, expected_revision=1)
                uow.commit()
            return 'committed'
        except RevisionConflict:
            return 'conflict'

    with ThreadPoolExecutor(max_workers=2) as executor:
        results = list(executor.map(attempt, ['first', 'second']))
    assert sorted(results) == ['committed', 'conflict']
    assert initial(store).revision == 2


def test_repository_lifetime_and_nested_transaction_guard(store):
    with store.unit_of_work() as uow:
        repository = uow.contexts
        with pytest.raises(RuntimeError, match='Nested'):
            with store.unit_of_work():
                pass
    with pytest.raises(RuntimeError, match='outside'):
        repository.get('CUST001')
    with pytest.raises(RuntimeError, match='closed'):
        uow.commit()
    with store.unit_of_work() as valid:
        assert valid.contexts.get('CUST001')


def mock_transaction_records(store):
    draft = next_draft(initial(store), status='mock_sent', approved_by='REVIEWER001', approved_at='2026-10-31T06:01:00Z', send_status='mock_sent', delivery_id='DELIVERY001')
    request = ReviewRequest(expected_revision=1, decision='approve', edited_message=None, feedback=None, delivery='mock_email')
    review = ReviewRecord(review_id='REVIEW001', draft_id=draft.draft_id, revision=2, actor_id='REVIEWER001', request=request, reviewed_at=draft.updated_at)
    delivery = OutboxRecord(delivery_id='DELIVERY001', draft_id=draft.draft_id, customer_id=draft.customer_id, campaign_key=draft.campaign_key, content_hash=message_hash(draft.message), sent_at=draft.updated_at, delivery='mock_email')
    audit = AuditRecord(audit_id='AUDIT001', event='mock_sent', actor_id='REVIEWER001', request_id='REQ001', occurred_at=draft.updated_at, draft=draft, review=request)
    return draft, review, delivery, audit


def test_review_delivery_contact_and_audit_rollback_together(store):
    draft, review, delivery, audit = mock_transaction_records(store)
    with pytest.raises(RuntimeError):
        with store.unit_of_work() as uow:
            uow.drafts.replace(draft, 1)
            uow.reviews.add(review)
            uow.deliveries.add(delivery)
            uow.audit.add(audit)
            uow.commit()
            raise RuntimeError('Simulated failure after staging all writes')
    with store.unit_of_work() as uow:
        assert uow.drafts.get('DRAFT001').status == 'ready_for_review'
        assert uow.reviews.for_draft('DRAFT001') == []
        assert uow.deliveries.for_customer('CUST001') == []
        assert uow.contexts.get('CUST001').contacts == []
        assert uow.audit.for_draft('DRAFT001') == []
    with store.unit_of_work() as uow:
        uow.drafts.replace(draft, 1)
        uow.reviews.add(review)
        uow.deliveries.add(delivery)
        uow.audit.add(audit)
        uow.commit()
    with store.unit_of_work() as uow:
        assert len(uow.reviews.for_draft('DRAFT001')) == 1
        assert len(uow.deliveries.for_customer('CUST001')) == 1
        assert len(uow.contexts.get('CUST001').contacts) == 1
        assert len(uow.audit.for_draft('DRAFT001')) == 1
        with pytest.raises(DuplicateRecord):
            uow.deliveries.add(delivery)
        other_id = delivery.model_copy(update={'delivery_id': 'DELIVERY002'})
        with pytest.raises(DuplicateRecord):
            uow.deliveries.add(other_id)


def test_cannot_insert_outbox_for_unapproved_draft(store):
    _, _, delivery, _ = mock_transaction_records(store)
    with store.unit_of_work() as uow:
        with pytest.raises(RevisionConflict):
            uow.deliveries.add(delivery)
        assert uow.deliveries.for_customer('CUST001') == []


def test_idempotency_lifecycle_and_scope_isolation(seed):
    now = [datetime(2026, 10, 31, 6, tzinfo=timezone.utc)]
    store = MemoryStorage(*seed, clock=lambda: now[0])
    request_hash = hash_json({'customer_id': 'CUST001'})
    with store.unit_of_work() as uow:
        assert uow.idempotency.reserve(scope(), request_hash).state == 'pending'
        uow.commit()
    with store.unit_of_work() as uow:
        with pytest.raises(OperationInProgress):
            uow.idempotency.reserve(scope(), request_hash)
        with pytest.raises(IdempotencyConflict):
            uow.idempotency.reserve(scope(), hash_json({'customer_id': 'CUST002'}))
    body = initial(store).model_dump(mode='json')
    now[0] += timedelta(minutes=1)
    with store.unit_of_work() as uow:
        uow.idempotency.complete(scope(), request_hash, 201, body)
        uow.commit()
    body['status'] = 'Changed outside storage'
    with store.unit_of_work() as uow:
        replay = uow.idempotency.reserve(scope(), request_hash)
        assert replay.state == 'completed' and replay.http_status == 201
        assert replay.response_body['status'] == 'ready_for_review'
        replay.response_body['status'] = 'Changed replay'
        for isolated in [scope(actor_id='REVIEWER002'), scope(path='/api/v1/drafts/DRAFT001/review'), scope(key='other_key')]:
            assert uow.idempotency.reserve(isolated, request_hash).state == 'pending'
        with pytest.raises(RevisionConflict):
            uow.idempotency.release(scope(), request_hash)
        uow.commit()
    now[0] += timedelta(hours=24)
    with store.unit_of_work() as uow:
        assert uow.idempotency.reserve(scope(), request_hash).state == 'pending'
        uow.idempotency.release(scope(), request_hash)
        assert uow.idempotency.reserve(scope(), request_hash).state == 'pending'
        uow.commit()


def test_idempotency_reservation_rolls_back_without_commit(store):
    digest = hash_json({'a': 1})
    with store.unit_of_work() as uow:
        uow.idempotency.reserve(scope(), digest)
    with store.unit_of_work() as uow:
        assert uow.idempotency.reserve(scope(), digest).state == 'pending'


@pytest.mark.parametrize('corruption', ['duplicate_customer', 'contact_fk', 'offer_conflict', 'future_activity', 'label_fk', 'paid_amount', 'unknown_bill', 'bad_type'])
def test_import_rejects_corrupt_seed_without_echoing_customer_data(tmp_path, corruption):
    raw = json.loads((ROOT / 'fixtures/dataset.json').read_text())
    first = raw['customers'][0]
    if corruption == 'duplicate_customer': raw['customers'].append(copy.deepcopy(first))
    if corruption == 'contact_fk': first['contacts'] = [{'contact_id': 'CONTACT001', 'customer_id': 'CUST999', 'campaign_key': 'test', 'channel': 'email', 'sent_at': raw['as_of'], 'delivery': 'mock_email'}]
    if corruption == 'offer_conflict': raw['customers'][1]['offers'][0]['terms'] = 'private-invalid-terms'
    if corruption == 'future_activity': first['customer']['last_activity_at'] = '2027-01-01T00:00:00Z'
    if corruption == 'label_fk': raw['labels'][0]['customer_id'] = 'CUST999'
    if corruption == 'paid_amount': first['billing']['amount_due']['amount_minor'] = 100
    if corruption == 'unknown_bill': first['billing']['status'] = 'unknown'
    if corruption == 'bad_type': first['customer']['loyalty_points'] = 'private-invalid-value'
    path = tmp_path / 'dataset.json'
    path.write_text(json.dumps(raw))
    with pytest.raises(FixtureError) as exc:
        load_fixtures(path, None)
    assert 'private-invalid' not in str(exc.value)


def test_external_seed_can_load_without_sample_drafts():
    dataset, drafts = load_fixtures(ROOT / 'fixtures/dataset.json', None)
    store = MemoryStorage(dataset, drafts)
    with store.unit_of_work() as uow:
        with pytest.raises(MissingRecord):
            uow.drafts.get('DRAFT001')


def test_scoped_context_and_draft_reads(client, reviewer_headers):
    context = client.get('/api/v1/customers/CUST001/context', headers=reviewer_headers)
    assert context.status_code == 200
    assert set(context.json()) == {'customer', 'consent', 'billing', 'contacts', 'offers', 'data_version', 'as_of'}
    response = client.get('/api/v1/drafts/DRAFT001', headers=reviewer_headers)
    assert response.status_code == 200
    assert response.json()['versions']['model_version'] == 'fixture_not_invoked'
    assert response.json()['send_status'] == 'not_sent'
    assert client.get('/api/v1/drafts/ABSENT', headers=reviewer_headers).status_code == 404
    assert client.post('/api/v1/drafts/ABSENT/review', headers=reviewer_headers, json={'expected_revision': 1, 'decision': 'approve', 'edited_message': None, 'feedback': None, 'delivery': 'mock_email'}).status_code == 404


def test_draft_ownership_cannot_be_bypassed(settings, reviewer_headers, seed):
    dataset, drafts = seed
    foreign = drafts[0].model_copy(update={'draft_id': 'FOREIGN', 'customer_id': 'CUST002'}, deep=True)
    app = create_app(settings, MemoryStorage(dataset, [foreign]))
    with TestClient(app) as client:
        assert client.get('/api/v1/drafts/FOREIGN', headers=reviewer_headers).status_code == 404
        assert client.get('/api/v1/customers/CUST002/context', headers=reviewer_headers).status_code == 404
        body = {'expected_revision': 1, 'decision': 'approve', 'edited_message': None, 'feedback': None, 'delivery': 'mock_email'}
        assert client.post('/api/v1/drafts/FOREIGN/review', headers=reviewer_headers, json=body).status_code == 404


def test_import_errors_fail_startup(settings, tmp_path):
    settings.dataset_path = str(tmp_path / 'missing.json')
    with pytest.raises(FixtureError):
        create_app(settings)


def test_relative_fixture_paths_are_anchored_to_backend(settings, tmp_path, monkeypatch):
    settings.dataset_path = 'fixtures/dataset.json'
    settings.draft_fixture_path = 'fixtures/drafts.json'
    monkeypatch.chdir(tmp_path)
    app = create_app(settings)
    with app.state.storage.unit_of_work() as uow:
        assert uow.drafts.get('DRAFT001').customer_id == 'CUST001'


def test_storage_instances_do_not_share_mutations(seed):
    first = MemoryStorage(*seed)
    second = MemoryStorage(*seed)
    with first.unit_of_work() as uow:
        uow.drafts.replace(next_draft(uow.drafts.get('DRAFT001'), status='rejected'), 1)
        uow.commit()
    assert initial(first).status == 'rejected'
    assert initial(second).status == 'ready_for_review'
