"""Least-context request and bundle contracts."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol, runtime_checkable

from orion.shared.identifiers import Identifier, Symbol
from orion.shared.result import Sensitivity


MAX_CONTEXT_ENTRIES = 64
MAX_CONTEXT_CHARACTERS = 16_384


@dataclass(frozen=True, slots=True)
class AuthenticatedRequest:
    request_id: Identifier
    correlation_id: Identifier
    principal_id: Identifier
    requested_capability: Symbol
    granted_capabilities: tuple[Symbol, ...]

    def __post_init__(self) -> None:
        if not isinstance(self.granted_capabilities, tuple):
            raise ValueError("granted_capabilities must be a tuple")
        object.__setattr__(self, "request_id", Identifier(self.request_id))
        object.__setattr__(self, "correlation_id", Identifier(self.correlation_id))
        object.__setattr__(self, "principal_id", Identifier(self.principal_id))
        object.__setattr__(self, "requested_capability", Symbol(self.requested_capability))
        object.__setattr__(
            self,
            "granted_capabilities",
            tuple(Symbol(capability) for capability in self.granted_capabilities),
        )


@dataclass(frozen=True, slots=True)
class ContextEntry:
    source: Symbol
    text: str
    sensitivity: Sensitivity

    def __post_init__(self) -> None:
        object.__setattr__(self, "source", Symbol(self.source))
        object.__setattr__(self, "sensitivity", Sensitivity(self.sensitivity))
        if not isinstance(self.text, str) or not self.text or len(self.text) > MAX_CONTEXT_CHARACTERS:
            raise ValueError("context entry text is empty or too large")


@dataclass(frozen=True, slots=True)
class ContextBundle:
    correlation_id: Identifier
    entries: tuple[ContextEntry, ...]

    def __post_init__(self) -> None:
        object.__setattr__(self, "correlation_id", Identifier(self.correlation_id))
        if not isinstance(self.entries, tuple):
            raise ValueError("context bundle entries must be a tuple")
        if not all(isinstance(entry, ContextEntry) for entry in self.entries):
            raise ValueError("context bundle entries must be ContextEntry values")
        if len(self.entries) > MAX_CONTEXT_ENTRIES:
            raise ValueError("context bundle has too many entries")
        if sum(len(entry.text) for entry in self.entries) > MAX_CONTEXT_CHARACTERS:
            raise ValueError("context bundle exceeds its character budget")


@runtime_checkable
class ContextPort(Protocol):
    def build(self, request: AuthenticatedRequest) -> ContextBundle: ...
