"""Approved-template rendering with the contract's allowlisted slots.

The backend's rendering is canonical. The AI service renders the same text only to hand
Gemini the exact slot values and minimum facts; validate_draft remains the judge.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import timezone

from app.contract.models import Context, Money, Offer, Plan, Policy, Template

ALLOWED_SLOTS = frozenset(
    {
        "display_name",
        "tenure_months",
        "offer_title",
        "offer_terms",
        "offer_expiry_date",
        "amount_due",
        "due_date",
        "required_disclaimer",
        "support_text",
    }
)
_OFFER_SLOTS = frozenset({"offer_title", "offer_terms", "offer_expiry_date"})
_PLACEHOLDER = re.compile(r"\{([^{}]*)\}")


class TemplateError(Exception):
    """The plan, policy and snapshot cannot produce an approved rendering."""


@dataclass(frozen=True)
class Slot:
    value: str
    # Snapshot field the value was taken from, and its raw value; None for policy wording.
    source_field: str | None
    source_value: str | int | float | bool | None


def placeholders(text: str) -> list[str]:
    names = _PLACEHOLDER.findall(text)
    unknown = sorted({n for n in names if n not in ALLOWED_SLOTS})
    if unknown:
        raise TemplateError(f"unrecognized placeholder(s): {', '.join(unknown)}")
    if "{" in _PLACEHOLDER.sub("", text) or "}" in _PLACEHOLDER.sub("", text):
        raise TemplateError("unbalanced brace in template")
    return names


def normalize(text: str) -> str:
    """The contract's only allowed normalization: CRLF -> LF and trimmed outer whitespace."""
    return text.replace("\r\n", "\n").strip()


def render(text: str, values: dict[str, str]) -> str:
    """Substitute once; substituted values are never interpreted as placeholders."""
    names = placeholders(text)
    missing = sorted({n for n in names if n not in values})
    if missing:
        raise TemplateError(f"unresolved placeholder(s): {', '.join(missing)}")
    return normalize(_PLACEHOLDER.sub(lambda m: values[m.group(1)], text))


def format_inr(money: Money) -> str:
    rupees, paise = divmod(money.amount_minor, 100)
    return f"INR {rupees}.{paise:02d}"


def select_template(plan: Plan, policy: Policy) -> Template:
    if plan.strategy is None:
        raise TemplateError("plan has no strategy")
    matches = [t for t in policy.templates if t.template_id == plan.strategy.template_id]
    if len(matches) != 1:
        raise TemplateError(f"template {plan.strategy.template_id} is not uniquely defined in policy")
    template = matches[0]
    if (template.objective, template.tone) != (plan.strategy.objective, plan.strategy.tone):
        raise TemplateError(f"template {template.template_id} does not match the plan's objective and tone")
    return template


def selected_offer(plan: Plan, context: Context) -> Offer | None:
    if plan.selected_offer_id is None:
        return None
    matches = [o for o in context.offers if o.offer_id == plan.selected_offer_id]
    if len(matches) != 1:
        raise TemplateError(f"selected offer {plan.selected_offer_id} is not uniquely in the snapshot")
    return matches[0]


def build_slots(template: Template, plan: Plan, context: Context, policy: Policy) -> dict[str, Slot]:
    """Only the slots this template uses: the minimum facts the model may see."""
    needed = set(placeholders(template.subject)) | set(placeholders(template.body))
    offer = selected_offer(plan, context)
    if needed & _OFFER_SLOTS and offer is None:
        raise TemplateError(f"template {template.template_id} needs an offer but the plan selected none")

    customer, billing = context.customer, context.billing
    slots: dict[str, Slot] = {}
    for name in sorted(needed):
        if name == "display_name":
            slots[name] = Slot(customer.display_name, "customer.display_name", customer.display_name)
        elif name == "tenure_months":
            slots[name] = Slot(str(customer.tenure_months), "customer.tenure_months", customer.tenure_months)
        elif name == "offer_title":
            slots[name] = Slot(offer.title, f"offers.{offer.offer_id}.title", offer.title)
        elif name == "offer_terms":
            slots[name] = Slot(offer.terms, f"offers.{offer.offer_id}.terms", offer.terms)
        elif name == "offer_expiry_date":
            expires = offer.expires_at.astimezone(timezone.utc)
            slots[name] = Slot(
                expires.date().isoformat(),
                f"offers.{offer.offer_id}.expires_at",
                expires.isoformat().replace("+00:00", "Z"),
            )
        elif name == "amount_due":
            if billing.amount_due is None:
                raise TemplateError("template needs amount_due but billing has none")
            slots[name] = Slot(format_inr(billing.amount_due), "billing.amount_due.amount_minor", billing.amount_due.amount_minor)
        elif name == "due_date":
            if billing.due_date is None:
                raise TemplateError("template needs due_date but billing has none")
            slots[name] = Slot(billing.due_date.isoformat(), "billing.due_date", billing.due_date.isoformat())
        elif name == "required_disclaimer":
            slots[name] = Slot(policy.required_disclaimer, None, None)
        elif name == "support_text":
            slots[name] = Slot(billing.support_text, None, None)
    return slots
