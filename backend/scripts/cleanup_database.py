"""Explicit demo retention job for the SQLite store; run manually, never scheduled.

Deletes expired idempotency records and AI turns, and drafts (with their reviews,
audit events and mock outbox rows) last updated before the retention window.
Customer contexts, consent and contact history are kept.
"""
import argparse
from pathlib import Path
import sys

from dotenv import dotenv_values

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.storage.sqlite import SQLiteStorage


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--database', default='data/codevortex.sqlite3')
    parser.add_argument('--retention-days', type=int, default=int(dotenv_values(ROOT / '.env').get('RETENTION_DAYS') or 7))
    parser.add_argument('--dry-run', action='store_true', help='report counts without deleting')
    args = parser.parse_args()
    if args.retention_days < 7:
        parser.error('retention must be at least 7 days')
    path = Path(args.database)
    path = path if path.is_absolute() else ROOT / path
    if not path.exists():
        parser.error('database file does not exist')
    storage = SQLiteStorage(path)
    with storage.unit_of_work() as uow:
        dedupe_days = uow.contexts.get_policy().dedupe_days
    counts = storage.purge_expired(args.retention_days, dedupe_days, dry_run=args.dry_run)
    verb = 'Would delete' if args.dry_run else 'Deleted'
    print(verb + ': ' + ', '.join('%s=%d' % item for item in sorted(counts.items())))


if __name__ == '__main__':
    main()
