"""Local structural check of a Gemini reply. Content truth is decided by validate_draft, not here."""

from __future__ import annotations

from dataclasses import dataclass

from pydantic import BaseModel, ConfigDict, ValidationError

from app.contract.models import Evidence, Message
from app.generation.templates import normalize


class CandidateError(Exception):
    """The reply is not usable output; eligible for the single repair attempt."""


class _Reply(BaseModel):
    model_config = ConfigDict(extra="forbid")
    message: Message
    evidence_fields: list[str]


@dataclass(frozen=True)
class Candidate:
    message: Message
    evidence: list[Evidence]


def parse_candidate(text: str, evidence_catalog: dict[str, Evidence]) -> Candidate:
    try:
        reply = _Reply.model_validate_json(text)
    except ValidationError as exc:
        raise CandidateError(_short(exc)) from exc

    unknown = [f for f in reply.evidence_fields if f not in evidence_catalog]
    if unknown:
        raise CandidateError(f"evidence_fields not in evidence_catalog: {', '.join(unknown[:5])}")

    try:
        message = Message(subject=normalize(reply.message.subject), body=normalize(reply.message.body))
    except ValidationError as exc:
        raise CandidateError(_short(exc)) from exc

    # Evidence values always come from the snapshot catalog, never from model text.
    fields = list(dict.fromkeys(reply.evidence_fields))
    return Candidate(message=message, evidence=[evidence_catalog[f] for f in fields])


def _short(exc: ValidationError) -> str:
    first = exc.errors()[0]
    loc = ".".join(str(p) for p in first.get("loc", ())) or "reply"
    return f"{loc}: {first.get('msg', 'invalid')}"
