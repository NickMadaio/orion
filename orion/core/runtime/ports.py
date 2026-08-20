"""Ambient-free runtime dependencies supplied by platform adapters."""

from __future__ import annotations

from datetime import datetime
from typing import Protocol, runtime_checkable

from orion.shared.identifiers import Identifier, Symbol


@runtime_checkable
class Clock(Protocol):
    def now(self) -> datetime: ...


@runtime_checkable
class IdentifierFactory(Protocol):
    def new(self, namespace: Symbol) -> Identifier: ...
