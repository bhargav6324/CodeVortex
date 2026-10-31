"""Explicit versioned import of approved email templates into the policy.

Validates the new templates against the policy rules and every stored customer,
backs up the SQLite store, then replaces the templates and template_version in
both the database and the seed dataset. Policy thresholds are not changed.
Existing drafts keep their old template_version and must be regenerated before approval.
"""
import argparse
from datetime import datetime, timezone
import json
from pathlib import Path
import sqlite3
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from app.models import Policy
from app.services.policy import PolicyEngine
from app.storage.sqlite import SQLiteStorage


def path_from_root(value):
    path = Path(value)
    return path if path.is_absolute() else ROOT / path


def check(policy, contexts, now):
    engine = PolicyEngine()
    problems = [item.message for item in engine.policy_findings(policy)]
    pairs = [(t.objective, t.tone) for t in policy.templates]
    if len(set(pairs)) != len(pairs):
        problems.append('Each objective/tone pair must have exactly one template.')
    if len({t.template_id for t in policy.templates}) != len(policy.templates):
        problems.append('Template IDs must be unique.')
    for template in policy.templates:
        text = (template.subject + '\n' + template.body).casefold()
        problems.extend('Template %s contains blocked phrase "%s".' % (template.template_id, phrase) for phrase in policy.blocked_phrases if phrase.casefold() in text)
    for context in contexts:
        plan = engine.evaluate(context, policy, now)
        if plan.strategy is not None and not any(f.code == 'POLICY_MISMATCH' for f in plan.validation.findings):
            message, _ = engine.render(context, policy, plan)
            problems.extend('%s: %s' % (context.customer.customer_id, f.code) for f in engine.content_findings(message, policy))
        elif plan.strategy is not None:
            problems.append('%s: no usable template for %s/%s' % (context.customer.customer_id, plan.strategy.objective, plan.strategy.tone))
    return problems


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('--templates', required=True)
    parser.add_argument('--template-version', required=True)
    parser.add_argument('--database', default='data/codevortex.sqlite3')
    parser.add_argument('--dataset', default='data/dataset.json')
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    database, dataset_path = path_from_root(args.database), path_from_root(args.dataset)
    if not database.exists():
        parser.error('database file does not exist')
    storage = SQLiteStorage(database)
    with storage.unit_of_work() as uow:
        current = uow.contexts.get_policy()
        contexts = [uow.contexts.get(customer_id) for customer_id in sorted(uow.staged.contexts)]
    if args.template_version == current.template_version:
        parser.error('template_version must differ from the current one (%s)' % current.template_version)
    templates = json.loads(path_from_root(args.templates).read_text(encoding='utf-8'))
    policy = Policy.model_validate(dict(current.model_dump(mode='json'), templates=templates, template_version=args.template_version))
    problems = check(policy, contexts, datetime.now(timezone.utc))
    if problems:
        raise SystemExit('Templates rejected:\n- ' + '\n- '.join(problems[:30]))
    print('Validated %d templates against %d customers.' % (len(policy.templates), len(contexts)))
    if args.dry_run:
        print('Dry run: nothing changed.')
        return

    stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    backup = database.with_name(database.name + '.before-' + args.template_version + '-' + stamp)
    source, target = sqlite3.connect(str(database)), sqlite3.connect(str(backup))
    try:
        source.backup(target)
    finally:
        target.close()
        source.close()
    backup.chmod(0o600)

    connection = sqlite3.connect(str(database), timeout=5, isolation_level=None)
    try:
        connection.execute('BEGIN IMMEDIATE')
        updated = connection.execute('UPDATE policy SET payload_json=? WHERE singleton_id=1', (policy.model_dump_json(),)).rowcount
        if updated != 1:
            raise SystemExit('Policy row not found; nothing changed.')
        connection.execute('COMMIT')
    except BaseException:
        connection.execute('ROLLBACK')
        raise
    finally:
        connection.close()

    if dataset_path.exists():
        raw = json.loads(dataset_path.read_text(encoding='utf-8'))
        raw['policy']['templates'] = templates
        raw['policy']['template_version'] = args.template_version
        dataset_path.write_text(json.dumps(raw, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    print('Updated policy to %s. Database backup: %s' % (args.template_version, backup.name))


if __name__ == '__main__':
    main()
