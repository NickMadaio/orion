"""Top-level ORION Core request boundary."""

from __future__ import annotations

from typing import Protocol, runtime_checkable

from orion.core.context.ports import AuthenticatedRequest
from orion.core.schemas import ExecutionResult


@runtime_checkable
class AgentPort(Protocol):
    """Handle an authenticated request without exposing adapter internals."""

    def handle(self, request: AuthenticatedRequest) -> ExecutionResult: ...
