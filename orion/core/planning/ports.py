"""Provider-neutral plan construction boundary."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from orion.core.context.ports import AuthenticatedRequest, ContextBundle
from orion.core.schemas import ProposalEnvelope


@runtime_checkable
class PlanningPort(Protocol):
    """Return bounded proposals; planning never executes them."""

    def plan(
        self,
        request: AuthenticatedRequest,
        context: ContextBundle,
    ) -> tuple[ProposalEnvelope, ...]: ...
