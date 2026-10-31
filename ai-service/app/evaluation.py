"""Evaluation over real turns: telemetry records vs the backend's labelled customers.

Inputs are the AI service's own turn log and the backend's `Dataset.labels`. Nothing here
creates data; metrics cover only customers that actually have a recorded turn.
"""

from __future__ import annotations

import json
import statistics
from dataclasses import dataclass, field
from pathlib import Path

from app.contract.models import DatasetLabel

SEGMENTS = ["consistent", "loyalty_candidate", "declining_activity", "dormant", "payment_reminder"]


@dataclass
class CustomerResult:
    customer_id: str
    expected_segments: list[str]
    got_segments: list[str]
    expected_objective: str | None
    got_objective: str | None
    expected_block_codes: list[str]
    got_finding_codes: list[str]
    outcome: str
    model_called: bool

    @property
    def segments_match(self) -> bool:
        return set(self.expected_segments) == set(self.got_segments)

    @property
    def objective_match(self) -> bool:
        return self.expected_objective == self.got_objective

    @property
    def expects_block(self) -> bool:
        return bool(self.expected_block_codes)

    @property
    def block_correct(self) -> bool:
        if self.expects_block:
            return self.outcome == "blocked" and set(self.expected_block_codes) <= set(self.got_finding_codes)
        return self.outcome == "generated"


@dataclass
class Report:
    labels_total: int
    results: list[CustomerResult]
    missing: list[str]
    turns: list[dict]
    per_segment: dict[str, dict[str, float | None]] = field(default_factory=dict)


def load_labels(path: Path) -> list[DatasetLabel]:
    doc = json.loads(path.read_text(encoding="utf-8"))
    raw = doc["labels"] if isinstance(doc, dict) else doc
    return [DatasetLabel.model_validate(item) for item in raw]


def load_turns(path: Path) -> list[dict]:
    lines = path.read_text(encoding="utf-8").splitlines()
    return [json.loads(line) for line in lines if line.strip()]


def evaluate(labels: list[DatasetLabel], turns: list[dict]) -> Report:
    # The latest completed turn per customer is the one compared with its label.
    latest: dict[str, dict] = {}
    for t in turns:
        if t.get("outcome") != "error" and t.get("customer_id"):
            latest[t["customer_id"]] = t

    results, missing = [], []
    for label in labels:
        t = latest.get(label.customer_id)
        if t is None:
            missing.append(label.customer_id)
            continue
        results.append(
            CustomerResult(
                customer_id=label.customer_id,
                expected_segments=list(label.expected_segments),
                got_segments=t.get("segments", []),
                expected_objective=label.expected_objective,
                got_objective=t.get("objective"),
                expected_block_codes=list(label.expected_block_codes),
                got_finding_codes=t.get("finding_codes", []),
                outcome=t["outcome"],
                model_called=t.get("gemini_attempts", 0) > 0,
            )
        )

    report = Report(labels_total=len(labels), results=results, missing=missing, turns=turns)
    for seg in SEGMENTS:
        tp = sum(seg in r.expected_segments and seg in r.got_segments for r in results)
        fp = sum(seg not in r.expected_segments and seg in r.got_segments for r in results)
        fn = sum(seg in r.expected_segments and seg not in r.got_segments for r in results)
        report.per_segment[seg] = {
            "precision": tp / (tp + fp) if tp + fp else None,
            "recall": tp / (tp + fn) if tp + fn else None,
            "support": tp + fn,
        }
    return report


def _pct(n: int, d: int) -> str:
    return f"{n}/{d} ({100 * n / d:.0f}%)" if d else "n/a (0 cases)"


def _num(x: float | None) -> str:
    return "n/a" if x is None else f"{x:.2f}"


def render_markdown(report: Report, *, generated_at: str, labels_source: str, turns_source: str) -> str:
    r = report.results
    turns = report.turns
    completed = [t for t in turns if t.get("outcome") != "error"]
    durations = sorted(t["duration_ms"] for t in turns if "duration_ms" in t)
    model_versions = sorted({t["model_version"] for t in completed if t.get("model_version")})
    prompt_versions = sorted({t["prompt_version"] for t in completed if t.get("prompt_version")})
    errors: dict[str, int] = {}
    for t in turns:
        if t.get("outcome") == "error":
            errors[t.get("error_code") or "UNKNOWN"] = errors.get(t.get("error_code") or "UNKNOWN", 0) + 1

    model_candidates = [x for x in r if x.model_called and x.outcome in ("generated", "blocked")]
    expect_block = [x for x in r if x.expects_block]
    expect_pass = [x for x in r if not x.expects_block]

    lines = [
        "# AI service evaluation",
        "",
        f"Generated {generated_at} from real turns recorded by the AI service. Labels: `{labels_source}`. Turns: `{turns_source}`.",
        "",
        "These are results on a small synthetic labelled set supplied by the backend, not a production accuracy claim.",
        "",
        "## Summary",
        "",
        "| Metric | Result |",
        "| --- | --- |",
        f"| Labelled customers with a recorded turn | {_pct(len(r), report.labels_total)} |",
        f"| Segment exact match (set equality) | {_pct(sum(x.segments_match for x in r), len(r))} |",
        f"| Objective match | {_pct(sum(x.objective_match for x in r), len(r))} |",
        f"| Expected-block cases blocked with the expected codes | {_pct(sum(x.block_correct for x in expect_block), len(expect_block))} |",
        f"| Expected-pass cases generated | {_pct(sum(x.block_correct for x in expect_pass), len(expect_pass))} |",
        f"| Model candidates passing validate_draft (slot/policy correctness) | {_pct(sum(x.outcome == 'generated' for x in model_candidates), len(model_candidates))} |",
        f"| Turns `unavailable` (model failures) | {_pct(sum(t.get('outcome') == 'unavailable' for t in turns), len(turns))} |",
        f"| Turns ending in an HTTP error | {_pct(sum(errors.values()), len(turns))} |",
        f"| Turn latency p50 / max | {f'{statistics.median(durations)} ms / {durations[-1]} ms' if durations else 'n/a'} |",
        f"| Model version(s) | {', '.join(model_versions) or 'none recorded'} |",
        f"| Prompt version(s) | {', '.join(prompt_versions) or 'none recorded'} |",
        "",
        "## Per-segment precision and recall",
        "",
        "| Segment | Precision | Recall | Support |",
        "| --- | --- | --- | --- |",
    ]
    for seg, m in report.per_segment.items():
        lines.append(f"| {seg} | {_num(m['precision'])} | {_num(m['recall'])} | {m['support']} |")

    lines += [
        "",
        "## Per customer",
        "",
        "| Customer | Expected segments | Got | Expected objective | Got | Expected block codes | Finding codes | Outcome | OK |",
        "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ]
    for x in r:
        ok = x.segments_match and x.objective_match and x.block_correct
        lines.append(
            f"| {x.customer_id} | {', '.join(x.expected_segments) or '—'} | {', '.join(x.got_segments) or '—'} "
            f"| {x.expected_objective or '—'} | {x.got_objective or '—'} | {', '.join(x.expected_block_codes) or '—'} "
            f"| {', '.join(x.got_finding_codes) or '—'} | {x.outcome} | {'yes' if ok else 'NO'} |"
        )
    if report.missing:
        lines += ["", f"No recorded turn for: {', '.join(report.missing)}."]
    if errors:
        lines += ["", "HTTP errors by code: " + ", ".join(f"{k} ×{v}" for k, v in sorted(errors.items())) + "."]

    lines += [
        "",
        "## Not measured here",
        "",
        "- Reviewer relevance, clarity and tone ratings: collected by the backend's review flow.",
        "- Segment and objective decisions are the backend's deterministic rules; these rows check that the AI service passes them through unchanged.",
        "",
    ]
    return "\n".join(lines)
