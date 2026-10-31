-- Schema version 1. Public wire schemas remain 1.0.0.
CREATE TABLE IF NOT EXISTS metadata (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS offers (
    offer_id TEXT PRIMARY KEY,
    terms_version TEXT NOT NULL,
    payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS contexts (
    customer_id TEXT PRIMARY KEY,
    payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS customer_offers (
    customer_id TEXT NOT NULL REFERENCES contexts(customer_id),
    offer_id TEXT NOT NULL REFERENCES offers(offer_id),
    position INTEGER NOT NULL CHECK (position >= 0),
    PRIMARY KEY(customer_id, offer_id),
    UNIQUE(customer_id, position)
);
CREATE TABLE IF NOT EXISTS policy (
    singleton_id INTEGER PRIMARY KEY CHECK (singleton_id = 1),
    payload_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS drafts (
    draft_id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES contexts(customer_id),
    revision INTEGER NOT NULL CHECK (revision >= 1),
    status TEXT NOT NULL CHECK (status IN ('ready_for_review','blocked','approved','rejected','mock_sent')),
    payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS drafts_customer ON drafts(customer_id);
CREATE TABLE IF NOT EXISTS reviews (
    review_id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL REFERENCES drafts(draft_id),
    revision INTEGER NOT NULL CHECK (revision >= 2),
    payload_json TEXT NOT NULL,
    UNIQUE(draft_id, revision)
);
CREATE TABLE IF NOT EXISTS outbox (
    delivery_id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL UNIQUE REFERENCES drafts(draft_id),
    customer_id TEXT NOT NULL REFERENCES contexts(customer_id),
    campaign_key TEXT NOT NULL,
    content_hash TEXT NOT NULL,
    sent_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS outbox_customer_time ON outbox(customer_id, sent_at);
CREATE INDEX IF NOT EXISTS outbox_content ON outbox(customer_id, content_hash);
CREATE TABLE IF NOT EXISTS audit (
    audit_id TEXT PRIMARY KEY,
    draft_id TEXT NOT NULL REFERENCES drafts(draft_id),
    occurred_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_draft_time ON audit(draft_id, occurred_at);
CREATE TABLE IF NOT EXISTS idempotency (
    scope_key TEXT PRIMARY KEY,
    actor_id TEXT NOT NULL,
    method TEXT NOT NULL,
    path TEXT NOT NULL,
    operation_key TEXT NOT NULL,
    expires_at TEXT NOT NULL,
    payload_json TEXT NOT NULL,
    UNIQUE(actor_id, method, path, operation_key)
);
CREATE INDEX IF NOT EXISTS idempotency_expiry ON idempotency(expires_at);
CREATE TABLE IF NOT EXISTS turns (
    turn_id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES contexts(customer_id),
    expires_at TEXT NOT NULL,
    payload_json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS turns_expiry ON turns(expires_at);
