"""Authorization-bound asynchronous job boundary."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Protocol, runtime_checkable

from orion.core.tools.ports import AuthorizedAction
from orion.shared.identifiers import Identifier


@dataclass(frozen=True, slots=True)
class JobReceipt:
    job_id: Identifier
    proposal_id: Identifier
    accepted_at: datetime

    def __post_init__(self) -> None:
        object.__setattr__(self, "job_id", Identifier(self.job_id))
        object.__setattr__(self, "proposal_id", Identifier(self.proposal_id))
        if (
            not isinstance(self.accepted_at, datetime)
            or self.accepted_at.tzinfo is None
            or self.accepted_at.utcoffset() is None
        ):
            raise ValueError("accepted_at must be timezone-aware")
        object.__setattr__(
            self,
            "accepted_at",
            self.accepted_at.astimezone(timezone.utc),
        )


@runtime_checkable
class JobPort(Protocol):
    """Submit only an authorization-bound action, never a raw proposal."""

    def submit(self, action: AuthorizedAction) -> JobReceipt: ...
