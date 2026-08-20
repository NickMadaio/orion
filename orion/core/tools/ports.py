"""Authorization-bound execution boundary; raw proposals cannot execute."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, runtime_checkable

from orion.core.schemas import DecisionEnvelope, ExecutionResult, ProposalEnvelope
from orion.shared.identifiers import Identifier
from orion.shared.result import DecisionOutcome


@dataclass(frozen=True, slots=True)
class AuthorizedAction:
    proposal: ProposalEnvelope
    decision: DecisionEnvelope
    approval_reference: Identifier | None = None

    def __post_init__(self) -> None:
        if not isinstance(self.proposal, ProposalEnvelope):
            raise ValueError("proposal must be a ProposalEnvelope")
        if not isinstance(self.decision, DecisionEnvelope):
            raise ValueError("decision must be a DecisionEnvelope")
        if self.approval_reference is not None:
            object.__setattr__(
                self,
                "approval_reference",
                Identifier(self.approval_reference),
            )
        if self.decision.proposal_id != self.proposal.proposal_id:
            raise ValueError("decision is not bound to this proposal")
        if self.decision.outcome is DecisionOutcome.DENY:
            raise ValueError("a denied proposal cannot become an authorized action")
        if (
            self.decision.outcome is DecisionOutcome.REQUIRE_APPROVAL
            and self.approval_reference is None
        ):
            raise ValueError("approval-gated action has no approval reference")
        if self.decision.outcome is DecisionOutcome.ALLOW and self.approval_reference is not None:
            raise ValueError("automatic action must not carry an unrelated approval")

    def is_valid_at(self, instant: datetime) -> bool:
        if not isinstance(instant, datetime) or instant.tzinfo is None or instant.utcoffset() is None:
            raise ValueError("authorization check requires an aware datetime")
        return self.decision.decided_at <= instant < self.decision.expires_at


@runtime_checkable
class ToolBrokerPort(Protocol):
    def execute(self, action: AuthorizedAction) -> ExecutionResult: ...
