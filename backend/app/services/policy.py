"""Pure deterministic Phase 3 decisions. No model calls, writes or hidden reasoning."""
from datetime import datetime, timedelta, timezone
from string import Formatter
import re
from typing import List

from app.models import Context, Evidence, Finding, Message, Plan, Policy, Segment, Strategy, Validation
from app.storage.fixtures import instant
from app.clock import stamp
from app.storage.records import message_hash

VERSION = 'validator_v1'
VARIABLES = {'display_name', 'tenure_months', 'offer_title', 'offer_terms', 'offer_expiry_date', 'amount_due', 'due_date', 'required_disclaimer', 'support_text'}
UNSAFE = re.compile(r'https?://|www\.|mailto:|[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}|\bBearer\s+\S+|\bsk-[A-Za-z0-9_-]{12,}', re.I)
PHONE = re.compile(r'\b\d{7,}\b')
INSTRUCTION = re.compile(r'\b(?:ignore|override)\b.{0,60}\b(?:instructions?|polic(?:y|ies)|rules?)\b|\b(?:system prompt|api key|execute code|reveal secrets?)\b', re.I)


def finding(code, field, message):
    return Finding(code=code, severity='block', field=field, message=message)


def validation(findings, now):
    unique = {}
    for item in findings:
        unique[(item.code, item.field)] = item
    rows = list(unique.values())[:30]
    return Validation(passed=not any(item.severity == 'block' for item in rows), findings=rows, checked_at=stamp(now), validator_version=VERSION)


def sensitive(text):
    # Currency values are permitted facts, not phone/account identifiers.
    without_money = re.sub(r'INR\s+\d+(?:\.\d{2})?', '', text, flags=re.I)
    return bool(UNSAFE.search(without_money) or PHONE.search(without_money))


def normalized(message):
    return {key: value.replace('\r\n', '\n').strip() for key, value in message.model_dump().items()}


class PolicyEngine:
    def evaluate(self, context: Context, policy: Policy, now: datetime, deliveries=()) -> Plan:
        if now.tzinfo is None:
            raise ValueError('Policy clock must be timezone-aware')
        now = now.astimezone(timezone.utc)
        c, b, consent = context.customer, context.billing, context.consent
        findings: List[Finding] = []
        segments: List[Segment] = []
        amount = b.amount_due.amount_minor if b.amount_due is not None else None
        due = datetime.strptime(b.due_date, '%Y-%m-%d').date() if b.due_date else None

        def segment(code, reason, fields):
            segments.append(Segment(code=code, reason_codes=[reason], confidence=1, evidence=[Evidence(field=field, value=value) for field, value in fields]))

        # Classification describes known status; stale billing separately blocks outreach.
        if b.status == 'overdue' and b.bill_id and amount is not None and amount > 0 and due and due < now.date() and b.verified_at and not b.dispute_open:
            segment('payment_reminder', 'VERIFIED_OVERDUE', [('billing.status', b.status), ('billing.amount_due.amount_minor', amount), ('billing.due_date', b.due_date), ('billing.verified_at', b.verified_at)])
        if c.activity_current_30d == 0 and c.last_activity_at and now - instant(c.last_activity_at) >= timedelta(days=policy.dormant_days):
            segment('dormant', 'NO_RECENT_ACTIVITY', [('customer.activity_current_30d', 0), ('customer.last_activity_at', c.last_activity_at)])
        if c.activity_previous_30d is not None and c.activity_previous_30d > 0 and c.activity_current_30d is not None and c.activity_current_30d / c.activity_previous_30d <= policy.decline_ratio:
            segment('declining_activity', 'ACTIVITY_DECLINED', [('customer.activity_current_30d', c.activity_current_30d), ('customer.activity_previous_30d', c.activity_previous_30d)])
        if c.loyalty_points >= policy.loyalty_points_threshold and c.tenure_months >= policy.loyalty_tenure_months:
            segment('loyalty_candidate', 'LOYALTY_THRESHOLD', [('customer.loyalty_points', c.loyalty_points), ('customer.tenure_months', c.tenure_months)])
        if c.timely_payments_last_3 == 3:
            segment('consistent', 'TIMELY_PAYMENT', [('customer.timely_payments_last_3', 3)])
        codes = {item.code for item in segments}
        if not segments:
            findings.append(finding('MISSING_EVIDENCE', 'customer', 'No supported segment can be established from the permitted evidence.'))
        if not consent.email_allowed:
            findings.append(finding('CHANNEL_BLOCKED', 'consent.email_allowed', 'Email outreach is not permitted.'))
        if b.status == 'disputed' or b.dispute_open:
            findings.append(finding('BILLING_DISPUTED', 'billing', 'Billing dispute requires the approved support path; outreach is blocked.'))
        elif b.status == 'unknown' or b.verified_at is None or not timedelta(0) <= now - instant(b.verified_at) <= timedelta(hours=policy.billing_max_age_hours):
            findings.append(finding('BILLING_UNVERIFIED', 'billing.verified_at', 'Billing evidence is missing, stale or future-dated; contact support.'))
        bad_bill = ((b.status == 'paid' and amount != 0) or
                    (b.status == 'current' and (amount is None or amount <= 0 or due is None or due < now.date())) or
                    (b.status == 'overdue' and (not b.bill_id or amount is None or amount <= 0 or due is None or due >= now.date())) or
                    (b.status == 'unknown' and any(x is not None for x in (b.amount_due, b.due_date, b.verified_at))))
        if bad_bill:
            findings.append(finding('CONTRADICTORY_DATA', 'billing', 'Billing fields are inconsistent; contact support.'))
        if any(value is not None and instant(value) > now for value in (c.last_activity_at, consent.recorded_at)):
            findings.append(finding('CONTRADICTORY_DATA', 'customer', 'Observed evidence cannot be dated in the future.'))
        if not c.display_name or not all(ch.isalpha() or ch in " '-" for ch in c.display_name) or INSTRUCTION.search(c.display_name):
            findings.append(finding('SENSITIVE_DATA', 'customer.display_name', 'Display name must contain only permitted name characters.'))
        if sensitive(b.support_text) or INSTRUCTION.search(b.support_text):
            findings.append(finding('SENSITIVE_DATA', 'billing.support_text', 'Support text contains an unapproved link or identifier.'))

        eligibility = []
        eligible = []
        for offer in context.offers:
            reasons = []
            if 'payment_reminder' in codes:
                reasons.append('BILLING_PRIORITY')
            if not instant(offer.valid_from) <= now < instant(offer.expires_at):
                reasons.append('OFFER_NOT_ACTIVE')
            if c.active_plan not in offer.allowed_plans:
                reasons.append('PLAN_NOT_ALLOWED')
            if c.loyalty_points < offer.min_loyalty_points:
                reasons.append('LOW_LOYALTY')
            if c.tenure_months < offer.min_tenure_months:
                reasons.append('LOW_TENURE')
            if not consent.marketing_opt_in:
                reasons.append('NO_MARKETING_CONSENT')
            eligibility.append({'offer_id': offer.offer_id, 'eligible': not reasons, 'reason_codes': reasons or ['ELIGIBLE']})
            if not reasons:
                eligible.append(offer)
        eligible.sort(key=lambda offer: (-offer.value.amount_minor, offer.offer_id))
        selected = None
        stage = 'none'
        if 'payment_reminder' in codes:
            objective, tone = 'payment_reminder', 'courteous'
            prior = any(contact.campaign_key == 'bill_' + b.bill_id + '_courteous' and instant(contact.sent_at) < now for contact in context.contacts)
            if (now.date() - due).days >= policy.firm_after_days and prior:
                stage, tone = 'firm', 'firm_respectful'
            else:
                stage = 'courteous'
        elif {'dormant', 'declining_activity'} & codes:
            objective, tone = 'reengagement', 'encouraging'
        elif 'loyalty_candidate' in codes and eligible:
            objective, tone, selected = 'reward', 'warm', eligible[0]
        elif {'loyalty_candidate', 'consistent'} & codes:
            objective, tone = 'appreciation', 'warm'
        else:
            objective, tone = None, None
        if objective in ('appreciation', 'reward', 'reengagement') and not consent.marketing_opt_in:
            findings.append(finding('CONSENT_REQUIRED', 'consent.marketing_opt_in', 'Marketing consent is required for this objective.'))
        if objective == 'payment_reminder' and not consent.service_email_allowed:
            findings.append(finding('CONSENT_REQUIRED', 'consent.service_email_allowed', 'Service-email permission is required for a reminder.'))

        strategy = None
        if objective:
            templates = [t for t in policy.templates if t.objective == objective and t.tone == tone]
            if len(templates) != 1:
                findings.append(finding('POLICY_MISMATCH', 'policy.templates', 'Exactly one approved template must match the selected strategy.'))
            else:
                strategy = Strategy(objective=objective, tone=tone, template_id=templates[0].template_id, reminder_stage=stage)
        campaign = ('reward_' + selected.offer_id + '_' + selected.terms_version if selected else
                    'appreciation_' + policy.policy_version if objective == 'appreciation' else
                    'reengagement_' + policy.policy_version if objective == 'reengagement' else
                    'bill_' + b.bill_id + '_' + stage if objective == 'payment_reminder' else 'blocked')
        if len(campaign) > 64:
            campaign = 'blocked'
            findings.append(finding('POLICY_MISMATCH', 'campaign_key', 'Configured campaign identifier exceeds the contract limit.'))
        recent = [contact for contact in context.contacts if now - timedelta(days=7) <= instant(contact.sent_at) <= now]
        if any(instant(contact.sent_at) > now for contact in context.contacts):
            findings.append(finding('CONTRADICTORY_DATA', 'contacts', 'Contact history cannot be future-dated.'))
        if len(recent) >= policy.max_contacts_7d:
            findings.append(finding('CONTACT_FREQUENCY', 'contacts', 'Contact frequency limit has been reached.'))
        if campaign != 'blocked' and any(contact.campaign_key == campaign for contact in recent):
            findings.append(finding('DUPLICATE_OUTREACH', 'contacts', 'This campaign was already delivered within the exclusion window.'))
        findings.extend(self.policy_findings(policy))
        plan = Plan(segments=segments, strategy=strategy, selected_offer_id=selected.offer_id if selected else None, eligibility=eligibility, validation=validation(findings, now), campaign_key=campaign)
        if strategy is not None:
            try:
                message, _ = self.render(context, policy, plan)
                checks = self.content_findings(message, policy)
                digest = message_hash(message)
                if any(item.content_hash == digest and now - timedelta(days=policy.dedupe_days) <= instant(item.sent_at) <= now for item in deliveries):
                    checks.append(finding('DUPLICATE_OUTREACH', 'message', 'Identical content was already delivered within the exclusion window.'))
                plan.validation = validation(list(plan.validation.findings) + checks, now)
            except (KeyError, ValueError, IndexError):
                plan.validation = validation(list(plan.validation.findings) + [finding('POLICY_MISMATCH', 'policy.templates', 'Approved template cannot be rendered from the available facts.')], now)
        return plan

    def policy_findings(self, policy):
        result = []
        for template in policy.templates:
            try:
                fields = set()
                for text in (template.subject, template.body):
                    for _, name, specification, conversion in Formatter().parse(text):
                        if name is not None:
                            if name not in VARIABLES or specification or conversion:
                                raise ValueError('Unsupported placeholder')
                            fields.add(name)
                required = {'required_disclaimer', 'support_text'}
                if template.objective == 'reward':
                    required |= {'offer_title', 'offer_terms', 'offer_expiry_date'}
                if template.objective == 'payment_reminder':
                    required |= {'amount_due', 'due_date'}
                    if fields & {'offer_title', 'offer_terms', 'offer_expiry_date'}:
                        raise ValueError('Reminder contains promotion placeholders')
                if not required <= fields:
                    raise ValueError('Required content missing')
            except ValueError:
                result.append(finding('POLICY_MISMATCH', 'policy.templates', 'Template contains unsupported placeholders or lacks required policy content.'))
        return result

    def content_findings(self, message, policy):
        text = message.subject + '\n' + message.body
        result = []
        if any(phrase.casefold() in text.casefold() for phrase in policy.blocked_phrases):
            result.append(finding('PROHIBITED_LANGUAGE', 'message', 'Message contains policy-blocked language.'))
        if sensitive(text) or INSTRUCTION.search(text):
            result.append(finding('SENSITIVE_DATA', 'message', 'Message contains an unapproved link, identifier or credential.'))
        if '{' in text or '}' in text:
            result.append(finding('POLICY_MISMATCH', 'message', 'Message contains unresolved template syntax.'))
        return result

    def render(self, context, policy, plan):
        if plan.strategy is None:
            raise ValueError('No approved strategy')
        if self.policy_findings(policy):
            raise ValueError('Invalid template policy')
        template = next(t for t in policy.templates if t.template_id == plan.strategy.template_id)
        c, b = context.customer, context.billing
        slots = {'display_name': c.display_name, 'tenure_months': str(c.tenure_months), 'required_disclaimer': policy.required_disclaimer, 'support_text': b.support_text}
        sources = {'display_name': ('customer.display_name', c.display_name), 'tenure_months': ('customer.tenure_months', c.tenure_months), 'required_disclaimer': ('policy.required_disclaimer', policy.required_disclaimer), 'support_text': ('billing.support_text', b.support_text)}
        if plan.selected_offer_id:
            offer = next(o for o in context.offers if o.offer_id == plan.selected_offer_id)
            slots.update(offer_title=offer.title, offer_terms=offer.terms, offer_expiry_date=offer.expires_at[:10])
            sources.update(offer_title=('offers.' + offer.offer_id + '.title', offer.title), offer_terms=('offers.' + offer.offer_id + '.terms', offer.terms), offer_expiry_date=('offers.' + offer.offer_id + '.expires_at', offer.expires_at))
        if plan.strategy.objective == 'payment_reminder':
            if b.amount_due is None or b.due_date is None:
                raise ValueError('Missing billing facts')
            amount = b.amount_due.amount_minor
            slots.update(amount_due='INR %d.%02d' % (amount // 100, amount % 100), due_date=b.due_date)
            sources.update(amount_due=('billing.amount_due.amount_minor', amount), due_date=('billing.due_date', b.due_date))
        used = {name for text in (template.subject, template.body) for _, name, _, _ in Formatter().parse(text) if name is not None}
        message = Message(subject=template.subject.format_map(slots), body=template.body.format_map(slots))
        evidence = [Evidence(field=sources[name][0], value=sources[name][1]) for name in sorted(used)]
        return message, evidence

    def validate_message(self, context, policy, now, message, selected_offer_id, template_id, deliveries=()):
        plan = self.evaluate(context, policy, now, deliveries)
        findings = list(plan.validation.findings)
        if selected_offer_id != plan.selected_offer_id or plan.strategy is None or template_id != plan.strategy.template_id:
            findings.append(finding('POLICY_MISMATCH', 'strategy', 'Candidate offer/template does not match the authoritative plan.'))
        if plan.strategy is not None:
            try:
                expected, _ = self.render(context, policy, plan)
                if normalized(message) != normalized(expected):
                    findings.append(finding('UNSUPPORTED_CLAIM', 'message', 'Candidate must equal the approved template rendered with verified facts.'))
            except (KeyError, ValueError, IndexError, StopIteration):
                findings.append(finding('POLICY_MISMATCH', 'message', 'Candidate cannot be checked against approved policy.'))
        findings.extend(self.content_findings(message, policy))
        return validation(findings, now)

    def allowed_evidence(self, context, policy):
        facts = {}
        def visit(prefix, value):
            if isinstance(value, dict):
                for key, item in value.items():
                    visit(prefix + '.' + key if prefix else key, item)
            elif value is None or isinstance(value, (str, int, float, bool)):
                facts[prefix] = value
        for prefix in ('customer', 'billing', 'consent'):
            visit(prefix, getattr(context, prefix).model_dump(mode='json'))
        for offer in context.offers:
            visit('offers.' + offer.offer_id, offer.model_dump(mode='json'))
        facts['policy.required_disclaimer'] = policy.required_disclaimer
        return facts
