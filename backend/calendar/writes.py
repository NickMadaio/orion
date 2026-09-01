"""Writing to a calendar: preview, policy, approval, audit — then, maybe, a write.

The manifest asks for four things before a write, and the order they are listed
in is the order they happen: preview, changed fields, policy, audit event. What
it does not say, because it is obvious right up until it is wrong, is that **the
thing approved has to be the thing executed**.

That is the oldest race in an approval flow. Between the person reading a
preview and the write going out, the draft can change — a retry with a different
body, a stale object reused, a caller that mutates in between. The person
approved a thirty-minute meeting and a three-hour one went out under their name.

So `Approval` carries a fingerprint of exactly what was previewed and `execute`
recomputes it. An approval is bound to content, not to an intention.
"""

from __future__ import annotations

import hashlib
import hmac
import json
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timezone
from enum import Enum

from backend.calendar.availability import Interval, conflicts
from backend.calendar.events import CalendarRefused, Event, Transparency
from backend.connectors.broker import Connection, ConnectorRefused, PreparedRequest
from backend.connectors.scopes import Feature
from backend.calendar.read import API
from orion.security.vocabulary import RiskLevel, at_least
from orion.shared.result import DecisionOutcome


class WriteKind(str, Enum):
    CREATE = "calendar.events.create"
    UPDATE = "calendar.events.update"
    #: Named separately from the two the manifest groups, because it is the one
    #: with no honest undo. See `undo_for`.
    DELETE = "calendar.events.delete"


#: Risk per operation. DELETE is strictly higher, and a test asserts the
#: inequality rather than the two values -- the point is the relationship.
RISK = {
    WriteKind.CREATE: RiskLevel.R2,
    WriteKind.UPDATE: RiskLevel.R2,
    WriteKind.DELETE: RiskLevel.R3,
}

#: The fields a write may set. Anything else in a draft is refused rather than
#: ignored: a field ORION does not understand, silently dropped, is a change the
#: person saw in a preview and did not get.
WRITABLE_FIELDS = ("summary", "description", "location", "starts_at", "ends_at", "transparency")


def _encodable(value: str, field: str) -> str:
    """Refuse text that cannot be encoded, for the same reason Gmail does.

    A local copy rather than an import: `calendar` declares no dependency on
    `gmail` and the boundary check would refuse one. Six lines duplicated is
    cheaper than a dependency that says two modules are related when they are
    not.
    """

    try:
        value.encode("utf-8")
    except UnicodeEncodeError as error:
        raise WriteRefused(
            f"{field} contains an unpaired surrogate and is not encodable text"
        ) from error
    return value


class WriteRefused(CalendarRefused):
    """The write was refused, and the reason names the rule."""


class ApprovalRefused(WriteRefused):
    """The approval does not authorise this write."""


class DelegationRefused(WriteRefused):
    """A narrowly delegated permission was used before Phase 50 exists."""


@dataclass(frozen=True, slots=True)
class EventDraft:
    """What a write would set. Not an Event: an Event is something that exists."""

    calendar_id: str
    summary: str
    starts_at: datetime
    ends_at: datetime
    description: str = ""
    location: str | None = None
    transparency: Transparency = Transparency.OPAQUE
    #: Present on an UPDATE and a DELETE, absent on a CREATE.
    event_id: str | None = None

    def __post_init__(self) -> None:
        set_ = object.__setattr__
        if not isinstance(self.calendar_id, str) or not self.calendar_id.strip():
            raise WriteRefused("a write names its calendar")
        if not isinstance(self.summary, str) or not self.summary.strip():
            raise WriteRefused("an event the person will see in their calendar needs a title")
        # Annotated `str` / `str | None` and never checked, so any object was
        # accepted and `default=str` flattened it into the fingerprint -- two
        # different drafts, one hash. Found by an independent review.
        if not isinstance(self.description, str):
            raise WriteRefused("description must be text")
        if self.location is not None and not isinstance(self.location, str):
            raise WriteRefused("location is text or absent")
        for field in ("summary", "description"):
            _encodable(getattr(self, field), field)
        if self.location is not None:
            _encodable(self.location, "location")
        set_(self, "transparency", Transparency(self.transparency))
        if self.transparency is Transparency.UNKNOWN:
            # UNKNOWN is what ORION records when it could not READ a value. It
            # is not something ORION may WRITE, because it would then be a value
            # the fail-safe treats as busy forever with no way to tell why.
            raise WriteRefused("UNKNOWN transparency is a reading, not a value to write")
        for name in ("starts_at", "ends_at"):
            value = getattr(self, name)
            if not isinstance(value, datetime) or value.tzinfo is None:
                raise WriteRefused(f"{name} must be an aware datetime")
            set_(self, name, value.astimezone(timezone.utc))
        if self.ends_at <= self.starts_at:
            raise WriteRefused("an event ends after it starts")

    @property
    def interval(self) -> Interval:
        return Interval(start=self.starts_at, end=self.ends_at)

    def values(self) -> Mapping[str, object]:
        """The writable fields, rendered so two drafts can be compared."""

        return {
            "summary": self.summary,
            "description": self.description,
            "location": self.location,
            "starts_at": self.starts_at.isoformat(),
            "ends_at": self.ends_at.isoformat(),
            "transparency": self.transparency.value,
        }


@dataclass(frozen=True, slots=True)
class ChangedField:
    """One field, what it was, and what it would become."""

    name: str
    before: object
    after: object


def changed_fields(before: Event | None, draft: EventDraft) -> tuple[ChangedField, ...]:
    """What this write would actually alter.

    On a CREATE every field is a change from nothing. On an UPDATE only the
    fields that differ are listed -- showing all six every time is a preview
    nobody reads, which is the same failure as showing none.
    """

    if before is None:
        return tuple(
            ChangedField(name=name, before=None, after=value)
            for name, value in draft.values().items()
            if value not in (None, "")
        )
    current = {
        "summary": before.summary,
        "description": "",
        "location": None,
        "starts_at": before.starts_at.isoformat() if before.starts_at else None,
        "ends_at": before.ends_at.isoformat() if before.ends_at else None,
        "transparency": before.transparency.value,
    }
    return tuple(
        ChangedField(name=name, before=current.get(name), after=value)
        for name, value in draft.values().items()
        if current.get(name) != value
    )


@dataclass(frozen=True, slots=True)
class Preview:
    """Everything the person is shown, and the thing an approval binds to."""

    kind: WriteKind
    draft: EventDraft
    changes: tuple[ChangedField, ...]
    risk: RiskLevel
    outcome: DecisionOutcome
    reason_codes: tuple[str, ...]
    #: Events this write would collide with. Shown, never blocking: a person is
    #: allowed to double-book, and a planner that refuses is one they work
    #: around outside ORION.
    collides_with: tuple[str, ...] = ()
    undo_available: bool = False
    undo_unavailable_because: str = ""

    def __post_init__(self) -> None:
        object.__setattr__(self, "kind", WriteKind(self.kind))
        object.__setattr__(self, "outcome", DecisionOutcome(self.outcome))
        object.__setattr__(self, "risk", RiskLevel(self.risk))
        if self.risk is not RISK[self.kind]:
            raise WriteRefused(
                f"{self.kind.value} is {RISK[self.kind].value}; a preview does not "
                f"choose its own risk"
            )
        # The undo claim is derived from the kind, not accepted from the caller.
        # Every invariant here used to live in the `preview()` function and
        # nothing forced callers through it, so a directly-built Preview could
        # assert a DELETE was undoable -- the one operation this phase is built
        # around having no undo -- and the audit record would say so.
        expected = _no_undo_reason(self.kind)
        if self.undo_available != (expected == ""):
            raise WriteRefused(
                f"a {self.kind.value} cannot claim undo_available={self.undo_available}"
            )
        if self.undo_unavailable_because != expected:
            raise WriteRefused("a preview does not write its own undo reason")
        if not self.changes:
            raise WriteRefused("a preview with no changes shows the person nothing")

    def fingerprint(self) -> str:
        """A stable hash of exactly what was shown.

        `sort_keys` and a fixed separator, so the same preview hashes the same
        way across processes. This is what the approval signs, and what
        `execute` recomputes.
        """

        # Everything the person is shown or the audit trail records.
        #
        # This used to be the draft, the changes and the risk. `collides_with`,
        # `reason_codes` and `undo_available` were outside it -- so a preview
        # saying "this clashes with your board meeting" and one saying nothing
        # shared a fingerprint, and an approval for the first authorised the
        # second. The requirement is that what was APPROVED is what executes,
        # and what was approved is the preview, not the draft inside it.
        payload = {
            "kind": self.kind.value,
            "calendar_id": self.draft.calendar_id,
            "event_id": self.draft.event_id,
            "values": dict(self.draft.values()),
            "changes": [
                {"name": item.name, "before": item.before, "after": item.after}
                for item in self.changes
            ],
            "risk": self.risk.value,
            "outcome": self.outcome.value,
            "reason_codes": list(self.reason_codes),
            "collides_with": list(self.collides_with),
            "undo_available": self.undo_available,
            "undo_unavailable_because": self.undo_unavailable_because,
        }
        # `ensure_ascii=False` and NO `default=str`. With the default, an
        # astral character is escaped as a surrogate PAIR, so a lone-surrogate
        # string hashed identically to the real one; and `default=str`
        # silently flattened any object into the hash, so a class with the
        # right `__str__` collided with a real string. Both were found by an
        # independent review, in a value used as an authorisation token.
        encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"), ensure_ascii=False)
        return hashlib.sha256(encoded.encode("utf-8")).hexdigest()


def preview(
    kind: WriteKind,
    draft: EventDraft,
    *,
    before: Event | None = None,
    existing: Sequence[Event] = (),
    outcome: DecisionOutcome = DecisionOutcome.REQUIRE_APPROVAL,
    reason_codes: tuple[str, ...] = (),
) -> Preview:
    """Build what the person is shown. Writes nothing.

    The manifest's first three requirements are discharged here: the preview
    itself, the changed fields, and the policy outcome carried alongside them so
    that a preview cannot be shown without one.
    """

    kind = WriteKind(kind)
    if kind is WriteKind.CREATE and draft.event_id is not None:
        raise WriteRefused("a create does not name an existing event")
    if kind is not WriteKind.CREATE and not draft.event_id:
        raise WriteRefused(f"a {kind.value} names the event it changes")
    if kind is WriteKind.UPDATE and before is None:
        raise WriteRefused(
            "an update needs the event as it stands; without it there are no changed fields "
            "to show and the preview would be a list of everything"
        )

    changes = changes_for(kind, before, draft)
    if kind is WriteKind.UPDATE and not changes:
        # A preview that can be empty teaches the person to approve without
        # reading, which costs more than the write it saved.
        raise WriteRefused("this update changes nothing")

    undo_reason = _no_undo_reason(kind)
    return Preview(
        kind=kind,
        draft=draft,
        changes=changes,
        risk=RISK[kind],
        outcome=DecisionOutcome(outcome),
        reason_codes=tuple(reason_codes),
        collides_with=tuple(
            event.event_id
            for event in conflicts(draft.interval, tuple(existing))
            if event.event_id != draft.event_id
        ),
        undo_available=undo_reason == "",
        undo_unavailable_because=undo_reason,
    )


def changes_for(
    kind: WriteKind, before: Event | None, draft: EventDraft
) -> tuple[ChangedField, ...]:
    if WriteKind(kind) is WriteKind.DELETE:
        return (ChangedField(name="existence", before="exists", after="deleted"),)
    return changed_fields(before, draft)


def _no_undo_reason(kind: WriteKind) -> str:
    if WriteKind(kind) is not WriteKind.DELETE:
        return ""
    return (
        "recreating a deleted event gives it a new id, loses every attendee's response "
        "and re-invites everybody -- that is a second event, not an undo"
    )


@dataclass(frozen=True, slots=True)
class Approval:
    """A person authorising one specific previewed write."""

    approval_id: str
    granted_by: str
    granted_at: datetime
    #: The fingerprint of the preview that was shown. Not the draft's -- the
    #: preview's, so the risk and the changed fields are part of what was signed.
    preview_fingerprint: str
    #: Reserved for Phase 50. Any value other than None is refused here.
    delegated_policy: str | None = None

    def __post_init__(self) -> None:
        set_ = object.__setattr__
        for name in ("approval_id", "granted_by", "preview_fingerprint"):
            value = getattr(self, name)
            if not isinstance(value, str) or not value.strip():
                raise ApprovalRefused(f"{name} is required")
        if not isinstance(self.granted_at, datetime) or self.granted_at.tzinfo is None:
            raise ApprovalRefused("granted_at must be an aware datetime")
        set_(self, "granted_at", self.granted_at.astimezone(timezone.utc))


@dataclass(frozen=True, slots=True)
class Authorized:
    """A write that may proceed, and the request that performs it."""

    preview: Preview
    approval: Approval
    request: PreparedRequest
    audit: Mapping[str, object]


def authorize(
    preview_shown: Preview,
    approval: Approval,
    connection: Connection,
    *,
    now: datetime,
    correlation_id: str,
    device_id: str,
    user_id: str,
) -> Authorized:
    """Check the approval against what was previewed, then build the request.

    Every refusal here still produces an audit record. An attempt that was
    refused is the most interesting thing an audit trail can hold, and a
    refusal that leaves no trace is indistinguishable from nothing happening.
    """

    if approval.delegated_policy is not None:
        raise DelegationRefused(
            "narrowly delegated calendar permissions are Phase 50; this phase starts "
            "with explicit approval and nothing else"
        )
    if preview_shown.outcome is DecisionOutcome.DENY:
        raise ApprovalRefused("policy denied this write; an approval cannot override a denial")
    if preview_shown.outcome is not DecisionOutcome.REQUIRE_APPROVAL:
        raise ApprovalRefused(
            "this phase starts with explicit approval, so a write must be gated on one"
        )
    expected = preview_shown.fingerprint()
    if not hmac.compare_digest(approval.preview_fingerprint, expected):
        # The person approved something else. Which one is not knowable here,
        # and does not matter: neither may proceed on this approval.
        raise ApprovalRefused(
            "this approval was granted for a different preview; nothing is written"
        )
    if Feature.CALENDAR_WRITE not in connection.features:
        raise ConnectorRefused("this connection does not carry calendar write")
    if not connection.can_fetch:
        raise ConnectorRefused(f"a connection in {connection.state.value} does not write")

    return Authorized(
        preview=preview_shown,
        approval=approval,
        request=_request_for(preview_shown, connection),
        audit=audit_details(
            preview_shown,
            approval=approval,
            now=now,
            correlation_id=correlation_id,
            device_id=device_id,
            user_id=user_id,
            outcome=DecisionOutcome.ALLOW,
        ),
    )


_METHOD = {
    WriteKind.CREATE: "POST",
    WriteKind.UPDATE: "PATCH",
    WriteKind.DELETE: "DELETE",
}


def _request_for(shown: Preview, connection: Connection) -> PreparedRequest:
    base = f"{API}/calendars/{shown.draft.calendar_id}/events"
    url = base if shown.kind is WriteKind.CREATE else f"{base}/{shown.draft.event_id}"
    return PreparedRequest(
        method=_METHOD[shown.kind],
        url=url,
        headers={"Content-Type": "application/json"},
        credential_ref=connection.credential_ref,
    )


def audit_details(
    shown: Preview,
    *,
    approval: Approval | None,
    now: datetime,
    correlation_id: str,
    device_id: str,
    user_id: str,
    outcome: DecisionOutcome,
    refusal: str = "",
) -> Mapping[str, object]:
    """The fields an `AuditEvent` for this write is built from.

    Returned as data rather than as a constructed event so that `orion.core`
    stays out of the backend's import graph -- Phase 1's rule that Core defines
    contracts and adapters execute them. The keys are `AuditEvent`'s own, so an
    adapter constructs one without a mapping step that could drop a field.
    """

    return {
        "correlation_id": correlation_id,
        "occurred_at": now.astimezone(timezone.utc).isoformat(),
        "actor": "user" if approval is not None else "orion",
        "user": user_id,
        "device": device_id,
        "proposed_action": shown.kind.value,
        "capability": "calendar_write",
        "resource": f"calendar:{shown.draft.calendar_id}",
        "risk": shown.risk.value,
        "outcome": DecisionOutcome(outcome).value,
        "reason_codes": list(shown.reason_codes) + ([refusal] if refusal else []),
        "approval_id": approval.approval_id if approval is not None else None,
        "changed_fields": [item.name for item in shown.changes],
        "preview_fingerprint": shown.fingerprint(),
        "undo_available": shown.undo_available,
    }


@dataclass(frozen=True, slots=True)
class Undo:
    """The inverse of a write that has already happened."""

    kind: WriteKind
    draft: EventDraft
    describes: str


def undo_for(shown: Preview, *, written_event_id: str | None = None) -> Undo | None:
    """The inverse operation, where one honestly exists.

    "Where practical" is the manifest's own hedge and it is doing real work.
    CREATE and UPDATE have inverses. DELETE does not, and returning one anyway
    would be the most damaging kind of wrong: the person believes their meeting
    is back, and their guests have been re-invited to something that is not the
    event they answered.
    """

    if shown.kind is WriteKind.DELETE:
        return None
    if shown.kind is WriteKind.CREATE:
        if not written_event_id:
            raise WriteRefused(
                "undoing a create needs the id the provider assigned; without it the "
                "undo would delete nothing or, worse, something else"
            )
        return Undo(
            kind=WriteKind.DELETE,
            draft=EventDraft(
                calendar_id=shown.draft.calendar_id,
                summary=shown.draft.summary,
                starts_at=shown.draft.starts_at,
                ends_at=shown.draft.ends_at,
                event_id=written_event_id,
            ),
            describes=f"delete the event this create added ({written_event_id})",
        )
    restored = {item.name: item.before for item in shown.changes}
    return Undo(
        kind=WriteKind.UPDATE,
        draft=EventDraft(
            calendar_id=shown.draft.calendar_id,
            event_id=shown.draft.event_id,
            summary=str(restored.get("summary") or shown.draft.summary),
            description=str(restored.get("description") or ""),
            location=restored.get("location") or None,
            starts_at=datetime.fromisoformat(str(restored["starts_at"]))
            if restored.get("starts_at")
            else shown.draft.starts_at,
            ends_at=datetime.fromisoformat(str(restored["ends_at"]))
            if restored.get("ends_at")
            else shown.draft.ends_at,
            transparency=Transparency(restored["transparency"])
            if restored.get("transparency")
            else shown.draft.transparency,
        ),
        describes="restore the field values this update replaced",
    )
