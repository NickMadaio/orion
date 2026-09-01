"""`gmail.send` — the one write in this program that cannot be taken back.

Structurally this is Phase 25 again: a person is shown something, approves it,
and something else must not go out. The same shape is used deliberately —
preview, a fingerprint over exactly what was shown, an approval carrying that
fingerprint, recomputed at authorization — because reinventing it here would be
a second implementation of a rule that has to hold in both places.

What differs is the cost of a mistake. A calendar write has an undo. **A sent
email does not**, for anybody, ever. So there is no undo path and the reason is
recorded rather than an inverse offered; and of the four things the manifest
requires be shown, the recipient is the one where a mismatch is both
unrecoverable and invisible, so it is covered by the fingerprint exactly, in
order.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import datetime, timezone

from backend.connectors.broker import Connection, ConnectorRefused, PreparedRequest
from backend.connectors.scopes import Feature
from backend.gmail.drafts import Draft, DraftRefused
from backend.gmail.search import API
from orion.security.vocabulary import RiskLevel
from orion.shared.result import DecisionOutcome


#: The manifest says treat initial sending as R3. Phase 5's own table puts
#: `messages_send` at R3 for the same reason: it reaches another person.
SEND_RISK = RiskLevel.R3

#: The four things the manifest requires on screen before an approval means
#: anything. A MINIMUM, held as a tuple so "we stopped showing attachments" is a
#: test failure. `SendPreview.on_screen` shows more than these -- the recipient
#: display names and the Reply-To redirect -- and everything it shows is hashed.
REQUIRED_ON_SCREEN = ("recipients", "subject", "body", "attachments")


class SendRefused(DraftRefused):
    """The send was refused, and the reason names the rule."""


class SendApprovalRefused(SendRefused):
    """The approval does not authorise this send."""


class SendDelegationRefused(SendRefused):
    """A narrow delegated policy was used before Phase 50 exists."""


class NotAPerson(SendApprovalRefused):
    """ORION tried to stand in for the human the approval is supposed to be."""


#: Names that are the system, not a person. An approval "granted by" any of
#: these is ORION approving itself.
SYSTEM_ACTORS = frozenset({"orion", "system", "automation", "assistant", "bot", "ai"})


def require_person(name: str, role: str, *, user_id: str) -> str:
    """The human whose account this is, and nobody else.

    An independent review had ORION review its own draft, grant its own
    approval as `granted_by="orion"`, and the audit record the actor as
    `"user"`. Every enumerated requirement of this phase was literally
    satisfied while nothing a person did was involved -- which is the property
    "require explicit approval" exists to deliver, as opposed to the sentence
    it is written as.
    """

    if not isinstance(name, str) or not name.strip():
        raise NotAPerson(f"the {role} must be named")
    cleaned = name.strip()
    if cleaned.lower() in SYSTEM_ACTORS:
        raise NotAPerson(
            f"{cleaned!r} is the system, not the {role}; sending needs a person"
        )
    if cleaned != user_id:
        raise NotAPerson(
            f"the {role} must be the account holder; {cleaned!r} is somebody else"
        )
    return cleaned


@dataclass(frozen=True, slots=True)
class SendPreview:
    """Exactly what the person is shown, and what an approval binds to."""

    draft: Draft
    risk: RiskLevel = SEND_RISK
    outcome: DecisionOutcome = DecisionOutcome.REQUIRE_APPROVAL
    reason_codes: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        object.__setattr__(self, "outcome", DecisionOutcome(self.outcome))
        if not isinstance(self.draft, Draft):
            raise SendRefused("a send preview is of a draft")
        if RiskLevel(self.risk) is not SEND_RISK:
            # The constant was pinned by a test and its USE was not, so a
            # preview could declare R1 and be audited as R1 -- an R3 action
            # recorded as something else. Sending is R3 because it reaches
            # another person, and no caller gets to say otherwise.
            raise SendRefused(
                f"sending is {SEND_RISK.value}; a preview does not choose its own risk"
            )
        if not self.draft.reviewed:
            # Phase 28's rule, enforced at the boundary that matters. Showing an
            # unreviewed draft for approval collapses two different questions --
            # "is this right?" and "may this go?" -- into one click.
            raise SendRefused(
                "this draft has not been reviewed; review and approval are different "
                "questions and must not be answered by the same click"
            )

    def on_screen(self) -> Mapping[str, object]:
        """The four the manifest names, plus what a person must not miss.

        `display_name` is attacker-chosen text that any UI rendering
        `Name <addr>` will show, so an approval for
        `Google Security Team <bob@x.com>` used to validate for
        `Bob <bob@x.com>`. And `reply_to_differs` is the redirect warning this
        phase built and then left off the approval screen entirely -- the one
        field it exists to surface was the one it did not show.
        """

        return {
            "recipients": [
                {
                    "address": recipient.address,
                    "display_name": (
                        recipient.display_name.value
                        if recipient.display_name is not None
                        else None
                    ),
                }
                for recipient in self.draft.recipients
            ],
            "subject": self.draft.subject,
            "body": self.draft.body,
            "attachments": list(self.draft.attachment_names),
            "reply_to_redirect": (
                self.draft.context.reply_to if self.draft.context.reply_to_differs else None
            ),
            "purpose": self.draft.purpose.value,
        }

    def fingerprint(self) -> str:
        """A stable hash of everything shown.

        The recipient list is hashed **in order** and not as a set: `to:` order
        is visible to every recipient, and a reordering that hashed the same
        would mean the approval covered a different-looking email.
        """

        payload = {
            "on_screen": dict(self.on_screen()),
            "draft_id": self.draft.draft_id,
            "thread_id": self.draft.context.thread_id,
            "message_id": self.draft.context.message_id,
            "risk": self.risk.value,
            "reviewed_by": self.draft.reviewed_by,
            "reviewed_fingerprint": self.draft.reviewed_fingerprint,
            "reason_codes": list(self.reason_codes),
            "outcome": self.outcome.value,
        }
        # `ensure_ascii=False`, deliberately. With the default an astral
        # character is escaped as a surrogate PAIR, so the lone-surrogate string
        # encodes identically to the real one -- a genuine collision in a value
        # used as an authorisation token, and one that reaches the RECIPIENT
        # field. `default=str` is gone with it: it silently flattened any object
        # into the hash, so an arbitrary class with the right __str__ collided
        # with a real string.
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


@dataclass(frozen=True, slots=True)
class SendApproval:
    """A person authorising one specific previewed send."""

    approval_id: str
    granted_by: str
    granted_at: datetime
    preview_fingerprint: str
    #: Reserved for Phase 50 -- the manifest's own example is "send routine
    #: availability confirmations". Any value is refused here.
    delegated_policy: str | None = None

    def __post_init__(self) -> None:
        set_ = object.__setattr__
        for name in ("approval_id", "granted_by", "preview_fingerprint"):
            value = getattr(self, name)
            if not isinstance(value, str) or not value.strip():
                raise SendApprovalRefused(f"{name} is required")
        if not isinstance(self.granted_at, datetime) or self.granted_at.tzinfo is None:
            raise SendApprovalRefused("granted_at must be an aware datetime")
        set_(self, "granted_at", self.granted_at.astimezone(timezone.utc))


@dataclass(frozen=True, slots=True)
class AuthorizedSend:
    preview: SendPreview
    approval: SendApproval
    request: PreparedRequest
    audit: Mapping[str, object]
    #: Always False, with the reason. Stated rather than omitted, because a
    #: caller that finds no undo field will assume one is coming.
    undo_available: bool = False
    undo_unavailable_because: str = (
        "a sent email cannot be recalled by anyone; there is no inverse operation to offer"
    )


def authorize_send(
    preview_shown: SendPreview,
    approval: SendApproval,
    connection: Connection,
    *,
    now: datetime,
    correlation_id: str,
    device_id: str,
    user_id: str,
) -> AuthorizedSend:
    """Check the approval against what was shown, then build the send request."""

    require_person(approval.granted_by, "approver", user_id=user_id)
    require_person(preview_shown.draft.reviewed_by or "", "reviewer", user_id=user_id)
    if approval.granted_at < preview_shown.draft.created_at:
        # An approval predating the thing it approves is not an approval of it.
        raise SendApprovalRefused(
            "this approval was granted before the draft existed"
        )
    if approval.delegated_policy is not None:
        raise SendDelegationRefused(
            "narrow delegated send policies -- 'send routine availability confirmations' "
            "and the like -- are Phase 50; this phase requires an explicit approval"
        )
    if preview_shown.outcome is DecisionOutcome.DENY:
        raise SendApprovalRefused("policy denied this send; an approval cannot override a denial")
    if preview_shown.outcome is not DecisionOutcome.REQUIRE_APPROVAL:
        raise SendApprovalRefused("sending requires an explicit approval, not a policy allow")
    expected = preview_shown.fingerprint()
    if not hmac.compare_digest(approval.preview_fingerprint, expected):
        raise SendApprovalRefused(
            "this approval was granted for a different preview; nothing is sent"
        )
    if Feature.GMAIL_SEND not in connection.features:
        raise ConnectorRefused("this connection does not carry gmail send")
    if not connection.can_fetch:
        raise ConnectorRefused(f"a connection in {connection.state.value} does not send")

    return AuthorizedSend(
        preview=preview_shown,
        approval=approval,
        request=PreparedRequest(
            method="POST",
            url=f"{API}/users/me/messages/send",
            headers={"Content-Type": "application/json"},
            credential_ref=connection.credential_ref,
        ),
        audit=send_audit_details(
            preview_shown,
            approval=approval,
            now=now,
            correlation_id=correlation_id,
            device_id=device_id,
            user_id=user_id,
            outcome=DecisionOutcome.ALLOW,
        ),
    )


def send_audit_details(
    shown: SendPreview,
    *,
    approval: SendApproval | None,
    now: datetime,
    correlation_id: str,
    device_id: str,
    user_id: str,
    outcome: DecisionOutcome,
    refusal: str = "",
) -> Mapping[str, object]:
    """The fields an `AuditEvent` for a send is built from.

    Recipients are recorded -- who an email went to is the whole question an
    audit trail of sending exists to answer. The BODY is not: a trail that keeps
    every sent message is a second mailbox, and Phase 6's redaction would have
    to strike it anyway.
    """

    return {
        "correlation_id": correlation_id,
        "occurred_at": now.astimezone(timezone.utc).isoformat(),
        "actor": "user" if approval is not None else "orion",
        "user": user_id,
        "device": device_id,
        "proposed_action": "gmail.send",
        "capability": "gmail_send",
        "resource": f"thread:{shown.draft.context.thread_id}",
        "risk": shown.risk.value,
        "outcome": DecisionOutcome(outcome).value,
        "reason_codes": list(shown.reason_codes) + ([refusal] if refusal else []),
        "approval_id": approval.approval_id if approval is not None else None,
        "recipients": [recipient.address for recipient in shown.draft.recipients],
        "attachment_count": len(shown.draft.attachment_names),
        "reviewed_by": shown.draft.reviewed_by,
        "preview_fingerprint": shown.fingerprint(),
        "undo_available": False,
    }
