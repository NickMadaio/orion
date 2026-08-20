"""Deterministic policy-decision boundary."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from orion.core.schemas import DecisionEnvelope, ProposalEnvelope
from orion.shared.identifiers import Identifier, Symbol


@dataclass(frozen=True, slots=True)
class PolicyContext:
    principal_id: Identifier
    granted_capabilities: tuple[Symbol, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.granted_capabilities, tuple):
            raise ValueError("granted_capabilities must be a tuple")
        object.__setattr__(self, "principal_id", Identifier(self.principal_id))
        object.__setattr__(
            self,
            "granted_capabilities",
            tuple(Symbol(capability) for capability in self.granted_capabilities),
        )


@runtime_checkable
class PolicyPort(Protocol):
    def decide(
        self, proposal: ProposalEnvelope, context: PolicyContext
    ) -> DecisionEnvelope: ...
