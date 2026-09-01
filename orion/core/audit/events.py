"""The audit event: the manifest's twelve fields, and nothing unredacted.

The live ledger records a task RUN. This records a DECISION -- what was proposed,
what the policy said, whether a person approved it, whether it ran, and what came
back -- which is the shape the manifest asks for and the shape an investigation
needs.

Redaction happens here, in the constructor, so there is no way to build an event
whose free text has not been through it and therefore no way to hand a sink an
unredacted one.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Mapping

from orion.core.audit.redaction import redact, redacted_summary
from orion.core.events.ports import AuditRecord
from orion.shared.identifiers import Identifier, Symbol
from orion.shared.json_values import thaw_json
from orion.shared.result import DecisionOutcome, ExecutionStatus, Sensitivity


SCHEMA_VERSION = 1

#: Who or what caused the action. Not the same question as `user`: an automation
#: acting for Nick has actor=automation, user=Nick, and conflating the two is how
#: an audit trail loses the ability to answer "who did this".
ACTORS = ("user", "orion", "automation", "remote_device", "system")

FIELDS = frozenset(
    {
        "schema_version",
        "event_id",
        "correlation_id",
        "occurred_at",
        "actor",
        "user",
        "device",
        "proposed_action",
        "capability",
        "resource",
        "decision",
        "approval",
        "execution",
        "result",
        "sensitivity",
        "details",
        "secure_debug",
    }
)


@dataclass(frozen=True, slots=True)
class DecisionRecord:
    outcome: DecisionOutcome
    risk: str
    reason_codes: tuple[str, ...]
    policy_version: Symbol

    def __post_init__(self) -> None:
        object.__setattr__(self, "outcome", DecisionOutcome(self.outcome))
        if not isinstance(self.risk, str) or not self.risk:
            raise ValueError("risk must be a non-empty string")
        if not isinstance(self.reason_codes, tuple) or not self.reason_codes:
            raise ValueError("a decision must record why it was made")
        object.__setattr__(self, "policy_version", Symbol(self.policy_version))

    def to_dict(self) -> dict[str, object]:
        return {
            "outcome": self.outcome.value,
            "risk": self.risk,
            "reason_codes": list(self.reason_codes),
            "policy_version": str(self.policy_version),
        }

    @classmethod
    def from_dict(cls, data: object) -> "DecisionRecord":
        if not isinstance(data, dict):
            raise ValueError("decision must be a JSON object")
        return cls(
            outcome=DecisionOutcome(data["outcome"]),
            risk=data["risk"],
            reason_codes=tuple(data["reason_codes"]),
            policy_version=Symbol(data["policy_version"]),
        )


@dataclass(frozen=True, slots=True)
class ApprovalRecord:
    approval_id: Identifier
    granted_by: Identifier
    method: Symbol
    granted_at: datetime

    def __post_init__(self) -> None:
        object.__setattr__(self, "approval_id", Identifier(self.approval_id))
        object.__setattr__(self, "granted_by", Identifier(self.granted_by))
        object.__setattr__(self, "method", Symbol(self.method))
        object.__setattr__(self, "granted_at", _aware(self.granted_at, "granted_at"))

    def to_dict(self) -> dict[str, object]:
        return {
            "approval_id": str(self.approval_id),
            "granted_by": str(self.granted_by),
            "method": str(self.method),
            "granted_at": _render(self.granted_at),
        }

    @classmethod
    def from_dict(cls, data: object) -> "ApprovalRecord":
        if not isinstance(data, dict):
            raise ValueError("approval must be a JSON object")
        return cls(
            approval_id=Identifier(data["approval_id"]),
            granted_by=Identifier(data["granted_by"]),
            method=Symbol(data["method"]),
            granted_at=_parse(data["granted_at"], "granted_at"),
        )


@dataclass(frozen=True, slots=True)
class ExecutionRecord:
    status: ExecutionStatus
    started_at: datetime
    finished_at: datetime
    attempt: int = 1

    def __post_init__(self) -> None:
        object.__setattr__(self, "status", ExecutionStatus(self.status))
        object.__setattr__(self, "started_at", _aware(self.started_at, "started_at"))
        object.__setattr__(self, "finished_at", _aware(self.finished_at, "finished_at"))
        if self.finished_at < self.started_at:
            raise ValueError("finished_at must not precede started_at")
        if type(self.attempt) is not int or self.attempt < 1:
            raise ValueError("attempt must be a positive integer")

    def to_dict(self) -> dict[str, object]:
        return {
            "status": self.status.value,
            "started_at": _render(self.started_at),
            "finished_at": _render(self.finished_at),
            "attempt": self.attempt,
        }

    @classmethod
    def from_dict(cls, data: object) -> "ExecutionRecord":
        if not isinstance(data, dict):
            raise ValueError("execution must be a JSON object")
        return cls(
            status=ExecutionStatus(data["status"]),
            started_at=_parse(data["started_at"], "started_at"),
            finished_at=_parse(data["finished_at"], "finished_at"),
            attempt=data.get("attempt", 1),
        )


@dataclass(frozen=True, slots=True)
class AuditEvent:
    event_id: Identifier
    correlation_id: Identifier
    occurred_at: datetime
    actor: str
    user: Identifier | None
    device: Identifier
    proposed_action: str
    capability: str
    resource: str
    decision: DecisionRecord
    sensitivity: Sensitivity
    approval: ApprovalRecord | None = None
    execution: ExecutionRecord | None = None
    result: str = ""
    details: Mapping[str, object] = field(default_factory=dict)
    #: The manifest's one exemption: complete prompts may be kept, but only
    #: under "explicit secure-debug mode". Explicit means per event, here, and
    #: the trail refuses these unless it is also in secure-debug -- two locks,
    #: because a debug mode that keeps conversations should not be reachable by
    #: getting one thing wrong.
    secure_debug: bool = False
    redactions: tuple[str, ...] = ()
    schema_version: int = SCHEMA_VERSION

    def __post_init__(self) -> None:
        if self.schema_version != SCHEMA_VERSION:
            raise ValueError("unsupported audit schema version")
        object.__setattr__(self, "event_id", Identifier(self.event_id))
        object.__setattr__(self, "correlation_id", Identifier(self.correlation_id))
        object.__setattr__(self, "occurred_at", _aware(self.occurred_at, "occurred_at"))
        if self.actor not in ACTORS:
            raise ValueError(f"actor must be one of {list(ACTORS)}")
        if self.user is not None:
            object.__setattr__(self, "user", Identifier(self.user))
        object.__setattr__(self, "device", Identifier(self.device))
        for name in ("proposed_action", "capability"):
            value = getattr(self, name)
            if not isinstance(value, str) or not value or len(value) > 128:
                raise ValueError(f"{name} must be a short non-empty string")
        # `proposed_action` and `capability` are short names in practice, and
        # "in practice" is not a guarantee: they are strings a caller controls,
        # so they go through the redactor with the rest. "No unredacted event
        # can exist" has to be true of every field, not most of them.
        if not isinstance(self.decision, DecisionRecord):
            raise ValueError("decision must be a DecisionRecord")
        object.__setattr__(self, "sensitivity", Sensitivity(self.sensitivity))
        if self.approval is not None and not isinstance(self.approval, ApprovalRecord):
            raise ValueError("approval must be an ApprovalRecord")
        if self.execution is not None and not isinstance(self.execution, ExecutionRecord):
            raise ValueError("execution must be an ExecutionRecord")

        # Everything a caller can put free text into goes through the redactor,
        # here, once. `redactions` is recomputed rather than trusted -- an event
        # that claims it was redacted is not the same as one that was -- but any
        # rules already recorded are kept alongside the new ones. Re-encoding a
        # decoded event must never make it look cleaner than the original: the
        # second pass finds the placeholder, not the credential.
        declared = tuple(self.redactions) if self.redactions else ()
        if not all(isinstance(rule, str) for rule in declared):
            raise ValueError("redactions must be rule names")
        struck = []
        for name in ("proposed_action", "capability", "resource", "result"):
            value = getattr(self, name)
            if not isinstance(value, str):
                raise ValueError(f"{name} must be a string")
            cleaned = redact(value, path=name)
            object.__setattr__(self, name, cleaned.value)
            struck.extend(cleaned.redactions)
        if not isinstance(self.secure_debug, bool):
            raise ValueError("secure_debug must be a boolean")
        cleaned_details = redact(self.details, path="details", keep_prompts=self.secure_debug)
        if not isinstance(cleaned_details.value, dict):
            raise ValueError("details must be a JSON object")
        object.__setattr__(self, "details", cleaned_details.value)
        struck.extend(cleaned_details.redactions)
        object.__setattr__(
            self,
            "redactions",
            tuple(sorted(set(redacted_summary(struck)) | set(declared))),
        )

        if not self.resource:
            raise ValueError("resource must say what was acted on")

    @property
    def redacted(self) -> bool:
        return bool(self.redactions)

    def to_audit_record(self) -> "AuditRecord":
        """The Phase 1 emission record, so the existing port still fits.

        Phase 1 defined a deliberately minimal `AuditRecord` as the emission
        boundary. This is the full decision; that is the envelope it travels in.
        Nothing that already consumes the port has to learn a new shape.
        """

        return AuditRecord(
            correlation_id=self.correlation_id,
            event=Symbol("policy.decision"),
            occurred_at=self.occurred_at,
            sensitivity=self.sensitivity,
            fields={
                "event_id": str(self.event_id),
                "capability": self.capability,
                "outcome": self.decision.outcome.value,
                "risk": self.decision.risk,
                "redactions": list(self.redactions),
            },
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "schema_version": self.schema_version,
            "event_id": str(self.event_id),
            "correlation_id": str(self.correlation_id),
            "occurred_at": _render(self.occurred_at),
            "actor": self.actor,
            "user": None if self.user is None else str(self.user),
            "device": str(self.device),
            "proposed_action": self.proposed_action,
            "capability": self.capability,
            "resource": self.resource,
            "decision": self.decision.to_dict(),
            "approval": None if self.approval is None else self.approval.to_dict(),
            "execution": None if self.execution is None else self.execution.to_dict(),
            "result": self.result,
            "sensitivity": self.sensitivity.value,
            "details": thaw_json(self.details),
            "secure_debug": self.secure_debug,
            "redactions": list(self.redactions),
        }

    @classmethod
    def from_dict(cls, data: object) -> "AuditEvent":
        if not isinstance(data, dict):
            raise ValueError("audit event must be a JSON object")
        fields: Mapping[str, Any] = data
        # `redactions` is derived, so it is accepted and ignored rather than
        # trusted -- a decoded event is re-redacted on the way in.
        unknown = sorted(set(fields) - FIELDS - {"redactions"})
        missing = sorted(FIELDS - set(fields))
        if unknown or missing:
            raise ValueError(f"audit event fields mismatch: unknown={unknown} missing={missing}")
        return cls(
            schema_version=fields["schema_version"],
            event_id=Identifier(fields["event_id"]),
            correlation_id=Identifier(fields["correlation_id"]),
            occurred_at=_parse(fields["occurred_at"], "occurred_at"),
            actor=fields["actor"],
            user=None if fields["user"] is None else Identifier(fields["user"]),
            device=Identifier(fields["device"]),
            proposed_action=fields["proposed_action"],
            capability=fields["capability"],
            resource=fields["resource"],
            decision=DecisionRecord.from_dict(fields["decision"]),
            approval=None if fields["approval"] is None else ApprovalRecord.from_dict(fields["approval"]),
            execution=None if fields["execution"] is None else ExecutionRecord.from_dict(fields["execution"]),
            result=fields["result"],
            sensitivity=Sensitivity(fields["sensitivity"]),
            details=fields["details"],
            secure_debug=fields["secure_debug"],
            redactions=tuple(fields.get("redactions", ())),
        )


def _aware(value: object, name: str) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be a timezone-aware datetime")
    return value.astimezone(timezone.utc)


def _parse(value: object, name: str) -> datetime:
    if isinstance(value, datetime):
        return _aware(value, name)
    if not isinstance(value, str):
        raise ValueError(f"{name} must be an ISO-8601 string")
    normalized = f"{value[:-1]}+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as error:
        raise ValueError(f"{name} must be a valid ISO-8601 timestamp") from error
    return _aware(parsed, name)


def _render(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
