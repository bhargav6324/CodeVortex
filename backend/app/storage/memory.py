"""Single-process development adapter; no durable state or delivery side effects."""
from copy import deepcopy
from threading import RLock
from typing import Callable, List, Optional

from app.clock import stamp, utc_now
from app.models import Dataset, Draft
from app.storage.fixtures import validate_dataset
from app.storage.repositories import State, Contexts, Drafts, Reviews, Deliveries, Audit, Idempotency, Turns


class MemoryUnitOfWork:
    def __init__(self, store):
        self.store = store
        self.closed = True
        self.committed = False
        self.entered = False

    def __enter__(self):
        if self.entered:
            raise RuntimeError('Unit of work cannot be reused')
        self.store.lock.acquire()
        if self.store.active:
            self.store.lock.release()
            raise RuntimeError('Nested units of work are not supported')
        try:
            self.staged = deepcopy(self.store.state)
            self.store.active = True
            self.entered = True
            self.closed = False
            self.turns = Turns(self)
            self.contexts = Contexts(self)
            self.drafts = Drafts(self)
            self.reviews = Reviews(self)
            self.deliveries = Deliveries(self)
            self.audit = Audit(self)
            self.idempotency = Idempotency(self)
            return self
        except Exception:
            self.store.lock.release()
            raise

    def commit(self):
        if self.closed:
            raise RuntimeError('Unit of work is closed')
        self.committed = True

    def __exit__(self, exc_type, exc_value, traceback):
        try:
            if exc_type is None and self.committed:
                self.store.state = self.staged
        finally:
            self.closed = True
            self.store.active = False
            self.store.lock.release()
        return False


class MemoryStorage:
    def __init__(self, dataset: Dataset, drafts: Optional[List[Draft]] = None, clock: Callable = utc_now):
        validate_dataset(dataset)
        self.lock = RLock()
        self.active = False
        self.clock = clock
        self.state = State(contexts={ctx.customer.customer_id: ctx.model_copy(deep=True) for ctx in dataset.customers}, policy=dataset.policy.model_copy(deep=True))
        # Evaluation labels deliberately do not enter runtime storage.
        with self.unit_of_work() as uow:
            for draft in drafts or []:
                uow.drafts.add(draft)
            uow.commit()

    def unit_of_work(self):
        return MemoryUnitOfWork(self)
