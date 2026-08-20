"""Strict Phase 1 envelopes with deterministic JSON conversion."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping

from orion.shared.identifiers import Identifier, Symbol
from orion.shared.json_values import freeze_json, freeze_json_object, thaw_json
from orion.shared.result import DecisionOutcome, ExecutionStatus, Sensitivity


SCHEMA_VERSION = 1


def _strict_fields(data: object, expected: frozenset[str]) -> Mapping[str, Any]:
    if not isinstance(data, dict):
        raise ValueError("envelope must be a JSON object")
    actual = set(data)
    unknown = sorted(actual - expected)
    missing = sorted(expected - actual)
    if unknown or missing:
        raise ValueError(f"envelope fields mismatch: unknown={unknown} missing={missing}")
    return data


def _schema_version(value: object) -> int:
    if type(value) is not int or value != SCHEMA_VERSION:
        raise ValueError("unsupported schema version")
    return SCHEMA_VERSION


def _aware_datetime(value: object, field: str) -> datetime:
    if not isinstance(value, str):
        raise ValueError(f"{field} must be an ISO-8601 string")
    normalized = f"{value[:-1]}+00:00" if value.endswith("Z") else value
    try:
        parsed = datetime.fromisoformat(normalized)
    except ValueError as error:
        raise ValueError(f"{field} must be a valid ISO-8601 timestamp") from error
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"{field} must include a timezone")
    return parsed.astimezone(timezone.utc)


def _render_datetime(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")


def _normalized_datetime(value: object, field: str) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{field} must include a timezone")
    return value.astimezone(timezone.utc)


def _string_tuple(value: object, field: str) -> tuple[str, ...]:
    if not isinstance(value, list) or not value:
        raise ValueError(f"{field} must be a non-empty JSON array")
    if not all(isinstance(item, str) and 0 < len(item) <= 256 for item in value):
        raise ValueError(f"{field} contains an invalid string")
    return tuple(value)


@dataclass(frozen=True, slots=True)
class ProposalEnvelope:
    schema_version: int
    proposal_id: Identifier
    correlation_id: Identifier
    source: Symbol
    capability: Symbol
    arguments: Mapping[str, object]
    created_at: datetime
    provenance: tuple[str, ...]
    sensitivity: Sensitivity

    FIELDS = frozenset(
        {
            "schema_version",
            "proposal_id",
            "correlation_id",
            "source",
            "capability",
            "arguments",
            "created_at",
            "provenance",
            "sensitivity",
        }
    )

    def __post_init__(self) -> None:
        _schema_version(self.schema_version)
        object.__setattr__(self, "proposal_id", Identifier(self.proposal_id))
        object.__setattr__(self, "correlation_id", Identifier(self.correlation_id))
        object.__setattr__(self, "source", Symbol(self.source))
        object.__setattr__(self, "capability", Symbol(self.capability))
        object.__setattr__(
            self,
            "arguments",
            freeze_json_object(self.arguments, "arguments"),
        )
        object.__setattr__(
            self,
            "created_at",
            _normalized_datetime(self.created_at, "created_at"),
        )
        if not isinstance(self.provenance, tuple) or not self.provenance or not all(
            isinstance(item, str) and 0 < len(item) <= 256 for item in self.provenance
        ):
            raise ValueError("provenance contains an invalid string")
        object.__setattr__(self, "provenance", tuple(self.provenance))
        object.__setattr__(self, "sensitivity", Sensitivity(self.sensitivity))

    @classmethod
    def from_dict(cls, data: object) -> "ProposalEnvelope":
        fields = _strict_fields(data, cls.FIELDS)
        arguments = fields["arguments"]
        if not isinstance(arguments, dict):
            raise ValueError("arguments must be a JSON object")
        return cls(
            schema_version=_schema_version(fields["schema_version"]),
            proposal_id=Identifier(fields["proposal_id"]),
            correlation_id=Identifier(fields["correlation_id"]),
            source=Symbol(fields["source"]),
            capability=Symbol(fields["capability"]),
            arguments=freeze_json(arguments),
            created_at=_aware_datetime(fields["created_at"], "created_at"),
            provenance=_string_tuple(fields["provenance"], "provenance"),
            sensitivity=Sensitivity(fields["sensitivity"]),
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "schema_version": self.schema_version,
            "proposal_id": str(self.proposal_id),
            "correlation_id": str(self.correlation_id),
            "source": str(self.source),
            "capability": str(self.capability),
            "arguments": thaw_json(self.arguments),
            "created_at": _render_datetime(self.created_at),
            "provenance": list(self.provenance),
            "sensitivity": self.sensitivity.value,
        }


@dataclass(frozen=True, slots=True)
class DecisionEnvelope:
    schema_version: int
    decision_id: Identifier
    proposal_id: Identifier
    outcome: DecisionOutcome
    policy_version: Symbol
    reason_codes: tuple[str, ...]
    decided_at: datetime
    expires_at: datetime

    FIELDS = frozenset(
        {
            "schema_version",
            "decision_id",
            "proposal_id",
            "outcome",
            "policy_version",
            "reason_codes",
            "decided_at",
            "expires_at",
        }
    )

    def __post_init__(self) -> None:
        _schema_version(self.schema_version)
        object.__setattr__(self, "decision_id", Identifier(self.decision_id))
        object.__setattr__(self, "proposal_id", Identifier(self.proposal_id))
        object.__setattr__(self, "outcome", DecisionOutcome(self.outcome))
        object.__setattr__(self, "policy_version", Symbol(self.policy_version))
        if not isinstance(self.reason_codes, tuple) or not self.reason_codes or not all(
            isinstance(item, str) and 0 < len(item) <= 256 for item in self.reason_codes
        ):
            raise ValueError("reason_codes contains an invalid string")
        object.__setattr__(self, "reason_codes", tuple(self.reason_codes))
        for field, value in (("decided_at", self.decided_at), ("expires_at", self.expires_at)):
            object.__setattr__(self, field, _normalized_datetime(value, field))
        if self.expires_at <= self.decided_at:
            raise ValueError("expires_at must be after decided_at")

    @classmethod
    def from_dict(cls, data: object) -> "DecisionEnvelope":
        fields = _strict_fields(data, cls.FIELDS)
        decided_at = _aware_datetime(fields["decided_at"], "decided_at")
        expires_at = _aware_datetime(fields["expires_at"], "expires_at")
        if expires_at <= decided_at:
            raise ValueError("expires_at must be after decided_at")
        return cls(
            schema_version=_schema_version(fields["schema_version"]),
            decision_id=Identifier(fields["decision_id"]),
            proposal_id=Identifier(fields["proposal_id"]),
            outcome=DecisionOutcome(fields["outcome"]),
            policy_version=Symbol(fields["policy_version"]),
            reason_codes=_string_tuple(fields["reason_codes"], "reason_codes"),
            decided_at=decided_at,
            expires_at=expires_at,
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "schema_version": self.schema_version,
            "decision_id": str(self.decision_id),
            "proposal_id": str(self.proposal_id),
            "outcome": self.outcome.value,
            "policy_version": str(self.policy_version),
            "reason_codes": list(self.reason_codes),
            "decided_at": _render_datetime(self.decided_at),
            "expires_at": _render_datetime(self.expires_at),
        }


@dataclass(frozen=True, slots=True)
class ExecutionResult:
    schema_version: int
    execution_id: Identifier
    proposal_id: Identifier
    status: ExecutionStatus
    observed_outcome: Mapping[str, object]
    audit_reference: Identifier
    started_at: datetime
    finished_at: datetime

    FIELDS = frozenset(
        {
            "schema_version",
            "execution_id",
            "proposal_id",
            "status",
            "observed_outcome",
            "audit_reference",
            "started_at",
            "finished_at",
        }
    )

    def __post_init__(self) -> None:
        _schema_version(self.schema_version)
        object.__setattr__(self, "execution_id", Identifier(self.execution_id))
        object.__setattr__(self, "proposal_id", Identifier(self.proposal_id))
        object.__setattr__(self, "status", ExecutionStatus(self.status))
        object.__setattr__(
            self,
            "observed_outcome",
            freeze_json_object(self.observed_outcome, "observed_outcome"),
        )
        object.__setattr__(self, "audit_reference", Identifier(self.audit_reference))
        for field, value in (("started_at", self.started_at), ("finished_at", self.finished_at)):
            object.__setattr__(self, field, _normalized_datetime(value, field))
        if self.finished_at < self.started_at:
            raise ValueError("finished_at must not precede started_at")

    @classmethod
    def from_dict(cls, data: object) -> "ExecutionResult":
        fields = _strict_fields(data, cls.FIELDS)
        observed = fields["observed_outcome"]
        if not isinstance(observed, dict):
            raise ValueError("observed_outcome must be a JSON object")
        started_at = _aware_datetime(fields["started_at"], "started_at")
        finished_at = _aware_datetime(fields["finished_at"], "finished_at")
        if finished_at < started_at:
            raise ValueError("finished_at must not precede started_at")
        return cls(
            schema_version=_schema_version(fields["schema_version"]),
            execution_id=Identifier(fields["execution_id"]),
            proposal_id=Identifier(fields["proposal_id"]),
            status=ExecutionStatus(fields["status"]),
            observed_outcome=freeze_json(observed),
            audit_reference=Identifier(fields["audit_reference"]),
            started_at=started_at,
            finished_at=finished_at,
        )

    def to_dict(self) -> dict[str, object]:
        return {
            "schema_version": self.schema_version,
            "execution_id": str(self.execution_id),
            "proposal_id": str(self.proposal_id),
            "status": self.status.value,
            "observed_outcome": thaw_json(self.observed_outcome),
            "audit_reference": str(self.audit_reference),
            "started_at": _render_datetime(self.started_at),
            "finished_at": _render_datetime(self.finished_at),
        }
