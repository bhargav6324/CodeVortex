"""Create/seed the actual local SQLite store once; never overwrite existing rows.

This is a setup operation, not an API/policy test or a live-memory migration.
"""
import argparse
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.storage.fixtures import load_fixtures
from app.storage.sqlite import SQLiteStorage


def path_from_root(value):
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--database', default='data/codevortex.sqlite3')
    parser.add_argument('--dataset', default='data/dataset.json')
    parser.add_argument('--drafts', default=None)
    args = parser.parse_args()
    storage = SQLiteStorage(path_from_root(args.database))
    if storage.seeded():
        print('Existing initialized database preserved. No seed rows changed.')
        return
    dataset, drafts = load_fixtures(path_from_root(args.dataset), path_from_root(args.drafts) if args.drafts else None)
    storage.seed(dataset, drafts)
    print('Initialized SQLite with %d customer contexts and policy. No API call, policy evaluation or test was run.' % len(dataset.customers))


if __name__ == '__main__':
    main()
