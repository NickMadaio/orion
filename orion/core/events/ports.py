"""Redacted audit emission boundary."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Mapping, Protocol, runtime_checkable

from orion.shared.identifiers import Identifier, Symbol
from orion.shared.json_values import freeze_json_object
from orion.shared.result import Sensitivity


@dataclass(frozen=True, slots=True)
class AuditRecord:
    correlation_id: Identifier
    event: Symbol
    occurred_at: datetime
    sensitivity: Sensitivity
    fields: Mapping[str, object]

    def __post_init__(self) -> None:
        object.__setattr__(self, "correlation_id", Identifier(self.correlation_id))
        object.__setattr__(self, "event", Symbol(self.event))
        object.__setattr__(self, "sensitivity", Sensitivity(self.sensitivity))
        if (
            not isinstance(self.occurred_at, datetime)
            or self.occurred_at.tzinfo is None
            or self.occurred_at.utcoffset() is None
        ):
            raise ValueError("audit timestamp must be timezone-aware")
        object.__setattr__(
            self,
            "fields",
            freeze_json_object(self.fields, "audit fields"),
        )


@runtime_checkable
class AuditSink(Protocol):
    def append(self, record: AuditRecord) -> Identifier: ...
