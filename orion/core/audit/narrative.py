"""The same event, told to a person.

The manifest asks for user-facing audit records that are understandable and for
developer logs kept separate. This is the separation: one event, rendered twice.
Two independent writes would be two things that can disagree, and an audit trail
that contradicts itself is worse than one that is merely terse.

Nothing here invents information. Every sentence comes from a field on the
event -- if the record does not know whether something ran, the sentence does
not say.
"""

from __future__ import annotations

from orion.core.audit.events import AuditEvent
from orion.shared.result import DecisionOutcome, ExecutionStatus


ACTOR_PHRASES = {
    "user": "You asked to",
    "orion": "Orion tried to",
    "automation": "An automation tried to",
    "remote_device": "Another of your devices tried to",
    "system": "Orion's system tried to",
}

#: Capability-name prefixes, in plain words. Keyed on prefix rather than on all
#: 78 actions: a table with one row per action is a table that goes stale the
#: first time somebody adds one.
CAPABILITY_PHRASES = (
    ("files.", "work with a file"),
    ("application.", "control an app"),
    ("browser.", "use the browser"),
    ("messages.", "read or send a message"),
    ("calendar.", "change your calendar"),
    ("reminder.", "set a reminder"),
    ("health.", "update your health log"),
    ("orion.", "change Orion himself"),
    ("device.", "check this Mac"),
    ("system.", "control this Mac"),
    ("voice_tuning.", "adjust his own voice"),
    ("simulation.", "run a practice action"),
    ("general.", "look something up"),
)

#: Reason codes in words. Anything unlisted falls back to a sentence that admits
#: it rather than printing a code at somebody.
REASON_PHRASES = {
    "request_expired": "the request had expired",
    "request_not_yet_valid": "the request was dated in the future",
    "origin_device_not_paired": "the device asking is not paired",
    "target_device_not_paired": "the device it would run on is not paired",
    "remote_execution_disabled": "Orion cannot act on another device yet",
    "no_authenticated_user": "nobody was signed in",
    "origin_device_not_owned_by_user": "that device is not yours",
    "target_device_not_owned_by_user": "that device is not yours",
    "profile_does_not_grant_tier": "your current permission level does not include it",
    "risk_above_profile_ceiling": "it is riskier than your current permission level allows",
    "security_state_locked": "Orion is locked",
    "security_state_heightened": "Orion is being careful right now",
    "external_data_drives_external_action": "it was driven by something Orion read online",
    "external_data_involved": "something Orion read online was involved",
    "external_content_cannot_authorize": "the instruction came from a web page or message, not from you",
    "model_initiated_beyond_local": "Orion suggested it himself, without you asking",
    "signature_required": "it arrived unsigned from another device",
    "signature_invalid": "its signature did not match",
    "signing_key_unknown": "it was signed with a key Orion does not know",
    "delegation_expired": "the permission you delegated had run out",
    "delegation_does_not_cover_capability": "the permission you delegated did not cover it",
    "delegation_risk_exceeded": "it was riskier than the permission you delegated",
    "delegation_not_for_this_user": "the delegated permission belongs to somebody else",
    "capability_requires_approval": "this kind of action always needs your say-so",
    "risk_requires_approval": "it cannot be undone",
    "risk_mismatch": "the request described its own risk wrongly",
    "unknown_capability": "Orion does not have that capability",
}

EXECUTION_PHRASES = {
    ExecutionStatus.SUCCEEDED: "It worked.",
    ExecutionStatus.FAILED: "It failed.",
    ExecutionStatus.DENIED: "It was refused before it ran.",
    ExecutionStatus.CANCELLED: "It was cancelled.",
}


def capability_phrase(capability: str) -> str:
    for prefix, phrase in CAPABILITY_PHRASES:
        if capability.startswith(prefix):
            return phrase
    return "do something"


#: A denial can carry six reasons. Three is where a sentence stops being an
#: explanation and starts being a list, and the developer record keeps all of
#: them anyway.
SPOKEN_REASON_LIMIT = 3


def reason_phrase(reason_codes: tuple[str, ...]) -> str:
    """The reasons, in words, in the record's own (sorted) order."""

    spoken: list[str] = []
    for code in reason_codes:
        phrase = REASON_PHRASES.get(code)
        if phrase and phrase not in spoken:
            spoken.append(phrase)
    if not spoken:
        return "Orion's rules did not allow it"
    remaining = len(spoken) - SPOKEN_REASON_LIMIT
    spoken = spoken[:SPOKEN_REASON_LIMIT]
    if len(spoken) == 1:
        sentence = spoken[0]
    else:
        sentence = f"{', '.join(spoken[:-1])}, and {spoken[-1]}"
    return f"{sentence}, among other reasons" if remaining > 0 else sentence


def describe(event: AuditEvent) -> str:
    """One short paragraph, no identifiers, no jargon, nothing invented."""

    sentences = [
        f"{ACTOR_PHRASES[event.actor]} {capability_phrase(event.capability)} "
        f"({event.resource})."
    ]

    outcome = event.decision.outcome
    if outcome is DecisionOutcome.ALLOW:
        sentences.append("Orion's rules allowed it without asking.")
    elif outcome is DecisionOutcome.REQUIRE_APPROVAL:
        sentences.append(f"Orion's rules asked first, because {reason_phrase(event.decision.reason_codes)}.")
    else:
        sentences.append(f"Orion's rules refused, because {reason_phrase(event.decision.reason_codes)}.")

    if event.approval is not None:
        who = "You" if event.user is not None and event.approval.granted_by == event.user else str(event.approval.granted_by)
        sentences.append(f"{who} approved it.")
    elif outcome is DecisionOutcome.REQUIRE_APPROVAL:
        sentences.append("It has not been approved.")

    if event.execution is not None:
        sentences.append(EXECUTION_PHRASES[event.execution.status])
        if event.execution.attempt > 1:
            sentences.append(f"That was attempt {event.execution.attempt}.")

    if event.result:
        sentences.append(event.result if event.result.endswith(".") else f"{event.result}.")

    return " ".join(sentences)
