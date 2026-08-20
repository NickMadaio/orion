"""Provider-neutral model proposal boundary."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from orion.core.context.ports import ContextBundle
from orion.core.schemas import ProposalEnvelope


@runtime_checkable
class ModelPort(Protocol):
    def propose(self, context: ContextBundle) -> ProposalEnvelope: ...
