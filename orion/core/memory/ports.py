"""Versioned, adapter-neutral persistence boundary."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Mapping, Protocol, runtime_checkable

from orion.shared.identifiers import Identifier, Symbol
from orion.shared.json_values import freeze_json_object
from orion.shared.result import Sensitivity


@dataclass(frozen=True, slots=True)
class MemoryRecord:
    record_id: Identifier
    record_type: Symbol
    revision: int
    recorded_at: datetime
    sensitivity: Sensitivity
    payload: Mapping[str, object]

    def __post_init__(self) -> None:
        object.__setattr__(self, "record_id", Identifier(self.record_id))
        object.__setattr__(self, "record_type", Symbol(self.record_type))
        if type(self.revision) is not int or self.revision < 1:
            raise ValueError("revision must be a positive integer")
        if (
            not isinstance(self.recorded_at, datetime)
            or self.recorded_at.tzinfo is None
            or self.recorded_at.utcoffset() is None
        ):
            raise ValueError("recorded_at must be timezone-aware")
        object.__setattr__(
            self,
            "recorded_at",
            self.recorded_at.astimezone(timezone.utc),
        )
        object.__setattr__(self, "sensitivity", Sensitivity(self.sensitivity))
        object.__setattr__(
            self,
            "payload",
            freeze_json_object(self.payload, "payload"),
        )


@runtime_checkable
class MemoryPort(Protocol):
    def load(self, record_id: Identifier) -> MemoryRecord | None: ...

    def save(
        self,
        record: MemoryRecord,
        expected_revision: int | None,
    ) -> None: ...
