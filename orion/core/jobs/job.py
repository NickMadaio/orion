"""The job record: the manifest's eleven fields, frozen.

Every transition returns a NEW job. A decision made against a job should stay
explicable afterwards, which it is not if the job it was made against has since
changed underneath it -- the same reasoning as Phase 5's device directory.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone
from typing import Any, Mapping

from orion.core.jobs.states import JobState, is_terminal, require_move
from orion.security.vocabulary import RiskLevel
from orion.shared.identifiers import Identifier
from orion.shared.json_values import freeze_json_object, thaw_json


#: A job that has failed this many times stops being retried. Small on purpose:
#: a job worth attempting four times is a job whose failure nobody is looking at.
DEFAULT_MAX_ATTEMPTS = 3

FIELDS = frozenset(
    {
        "job_id",
        "user_id",
        "origin_device",
        "target_device",
        "capability",
        "arguments",
        "risk_level",
        "created_at",
        "expires_at",
        "idempotency_key",
        "status",
    }
)


@dataclass(frozen=True, slots=True)
class Job:
    job_id: Identifier
    user_id: Identifier
    origin_device: Identifier
    target_device: Identifier
    capability: str
    arguments: Mapping[str, object]
    risk_level: RiskLevel
    created_at: datetime
    expires_at: datetime
    idempotency_key: str
    status: JobState = JobState.CREATED
    attempts: int = 0
    max_attempts: int = DEFAULT_MAX_ATTEMPTS
    delivery_token: Identifier | None = None
    lease_expires_at: datetime | None = None
    approval_reference: Identifier | None = None
    reason: str = ""

    def __post_init__(self) -> None:
        for name in ("job_id", "user_id", "origin_device", "target_device"):
            object.__setattr__(self, name, Identifier(getattr(self, name)))
        if not isinstance(self.capability, str) or not self.capability:
            raise ValueError("capability must be a non-empty string")
        object.__setattr__(self, "arguments", freeze_json_object(self.arguments, "arguments"))
        object.__setattr__(self, "risk_level", RiskLevel(self.risk_level))
        for name in ("created_at", "expires_at"):
            object.__setattr__(self, name, _aware(getattr(self, name), name))
        if self.expires_at <= self.created_at:
            # Every job expires. A job with no end is a standing instruction
            # nobody issued, waiting for a device to reconnect.
            raise ValueError("expires_at must be after created_at")
        if not isinstance(self.idempotency_key, str) or not (1 <= len(self.idempotency_key) <= 128):
            raise ValueError("idempotency_key must be a short non-empty string")
        object.__setattr__(self, "status", JobState(self.status))
        if type(self.attempts) is not int or self.attempts < 0:
            raise ValueError("attempts must be a non-negative integer")
        if type(self.max_attempts) is not int or self.max_attempts < 1:
            raise ValueError("max_attempts must be at least 1")
        if self.delivery_token is not None:
            object.__setattr__(self, "delivery_token", Identifier(self.delivery_token))
        if self.lease_expires_at is not None:
            object.__setattr__(self, "lease_expires_at", _aware(self.lease_expires_at, "lease_expires_at"))
        if self.approval_reference is not None:
            object.__setattr__(self, "approval_reference", Identifier(self.approval_reference))

    # -- questions ---------------------------------------------------------

    def is_expired_at(self, now: datetime) -> bool:
        return _aware(now, "now") >= self.expires_at

    def lease_lost_at(self, now: datetime) -> bool:
        """Whether a dispatched job's device has gone quiet.

        A lost acknowledgement is indistinguishable from a slow one, which is why
        this is a lease and not a failure: the job goes back to the queue and the
        delivery token changes, so the late answer cannot land.
        """

        return self.lease_expires_at is not None and _aware(now, "now") >= self.lease_expires_at

    def retriable(self) -> bool:
        return self.attempts < self.max_attempts

    @property
    def terminal(self) -> bool:
        return is_terminal(self.status)

    # -- moves -------------------------------------------------------------

    def moved_to(self, status: JobState, **changes: Any) -> "Job":
        require_move(self.status, status)
        return replace(self, status=status, **changes)

    def to_dict(self) -> dict[str, object]:
        return {
            "job_id": str(self.job_id),
            "user_id": str(self.user_id),
            "origin_device": str(self.origin_device),
            "target_device": str(self.target_device),
            "capability": self.capability,
            "arguments": thaw_json(self.arguments),
            "risk_level": self.risk_level.value,
            "created_at": _render(self.created_at),
            "expires_at": _render(self.expires_at),
            "idempotency_key": self.idempotency_key,
            "status": self.status.value,
            "attempts": self.attempts,
            "delivery_token": None if self.delivery_token is None else str(self.delivery_token),
        }


def _aware(value: object, name: str) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be a timezone-aware datetime")
    return value.astimezone(timezone.utc)


def _render(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
