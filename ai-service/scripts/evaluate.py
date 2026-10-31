"""Build EVALUATION.md from recorded turns and the backend's labels.

Usage (from ai-service/):
    .venv/Scripts/python scripts/evaluate.py --labels <backend Dataset or labels JSON> \
        [--turns logs/turns.jsonl] [--out ../EVALUATION.md]

Run the backend's labelled customers through real generate turns first; this script only reads.
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.evaluation import evaluate, load_labels, load_turns, render_markdown  # noqa: E402


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--labels", required=True, type=Path)
    parser.add_argument("--turns", default=Path("logs/turns.jsonl"), type=Path)
    parser.add_argument("--out", default=Path("../EVALUATION.md"), type=Path)
    args = parser.parse_args()

    if not args.turns.exists():
        print(f"No turn log at {args.turns}. Run real generate turns first.")
        return 1

    report = evaluate(load_labels(args.labels), load_turns(args.turns))
    markdown = render_markdown(
        report,
        generated_at=datetime.now(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        labels_source=args.labels.name,
        turns_source=args.turns.as_posix(),
    )
    args.out.write_text(markdown, encoding="utf-8", newline="\n")
    print(f"Wrote {args.out} ({len(report.results)}/{report.labels_total} labelled customers with a turn)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
