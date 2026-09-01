"""The versioned internal event envelope: the manifest's nine fields.

The payload **refuses** credentials rather than redacting them. Phase 6 redacts,
because an audit record has to be written even when something in it should not
be. An event is data moving between subsystems, and a payload carrying a
credential is a defect at the producer -- redacting it would let that defect ship
quietly and reappear later as a field nobody can explain.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Mapping

from orion.core.audit.patterns import CREDENTIAL_SHAPES, field_is_sensitive
from orion.core.eventbus.categories import Category, at_least_as_sensitive, floor_for
from orion.shared.identifiers import Identifier
from orion.shared.json_values import freeze_json_object, thaw_json
from orion.shared.result import Sensitivity


SCHEMA_VERSION = 1

_EVENT_TYPE = re.compile(r"^[a-z][a-z0-9_]*\.[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)?$")

FIELDS = frozenset(
    {
        "event_id",
        "event_type",
        "version",
        "user_id",
        "source",
        "occurred_at",
        "sensitivity",
        "correlation_id",
        "payload",
    }
)


class CredentialInPayload(ValueError):
    """A payload carried something shaped like a credential, or a field named
    like one.

    Its own type because it is not a schema problem and must not be caught by a
    handler that catches malformed events. Nothing in ORION should ever publish
    a credential; a bus that quietly cleaned this up would hide the producer that
    needs fixing.
    """


@dataclass(frozen=True, slots=True)
class EventEnvelope:
    event_id: Identifier
    event_type: str
    version: int
    user_id: Identifier | None
    source: str
    occurred_at: datetime
    sensitivity: Sensitivity
    correlation_id: Identifier
    payload: Mapping[str, object]

    def __post_init__(self) -> None:
        object.__setattr__(self, "event_id", Identifier(self.event_id))
        if not isinstance(self.event_type, str) or not _EVENT_TYPE.fullmatch(self.event_type):
            raise ValueError(f"event_type must be dotted and lowercase, got {self.event_type!r}")
        if type(self.version) is not int or self.version < 1:
            raise ValueError("version must be a positive integer")
        if self.user_id is not None:
            object.__setattr__(self, "user_id", Identifier(self.user_id))
        if not isinstance(self.source, str) or not self.source or len(self.source) > 128:
            raise ValueError("source must be a short non-empty string")
        if (
            not isinstance(self.occurred_at, datetime)
            or self.occurred_at.tzinfo is None
            or self.occurred_at.utcoffset() is None
        ):
            raise ValueError("occurred_at must be timezone-aware")
        object.__setattr__(self, "occurred_at", self.occurred_at.astimezone(timezone.utc))
        object.__setattr__(self, "sensitivity", Sensitivity(self.sensitivity))
        object.__setattr__(self, "correlation_id", Identifier(self.correlation_id))
        object.__setattr__(self, "payload", freeze_json_object(self.payload, "payload"))
        refuse_credentials(self.payload)

        floor = floor_for(self.category)
        if not at_least_as_sensitive(self.sensitivity, floor):
            raise ValueError(
                f"a {self.category.value} event may not be less sensitive than {floor.value}"
            )

    @property
    def category(self) -> Category:
        return Category(self.event_type.split(".", 1)[0])

    def to_dict(self) -> dict[str, object]:
        return {
            "event_id": str(self.event_id),
            "event_type": self.event_type,
            "version": self.version,
            "user_id": None if self.user_id is None else str(self.user_id),
            "source": self.source,
            "occurred_at": self.occurred_at.isoformat().replace("+00:00", "Z"),
            "sensitivity": self.sensitivity.value,
            "correlation_id": str(self.correlation_id),
            "payload": thaw_json(self.payload),
        }

    @classmethod
    def from_dict(cls, data: object) -> "EventEnvelope":
        if not isinstance(data, dict):
            raise ValueError("event must be a JSON object")
        unknown = sorted(set(data) - FIELDS)
        missing = sorted(FIELDS - set(data))
        if unknown or missing:
            raise ValueError(f"event fields mismatch: unknown={unknown} missing={missing}")
        fields: Mapping[str, Any] = data
        occurred = fields["occurred_at"]
        if isinstance(occurred, str):
            text = f"{occurred[:-1]}+00:00" if occurred.endswith("Z") else occurred
            occurred = datetime.fromisoformat(text)
        return cls(
            event_id=Identifier(fields["event_id"]),
            event_type=fields["event_type"],
            version=fields["version"],
            user_id=None if fields["user_id"] is None else Identifier(fields["user_id"]),
            source=fields["source"],
            occurred_at=occurred,
            sensitivity=Sensitivity(fields["sensitivity"]),
            correlation_id=Identifier(fields["correlation_id"]),
            payload=fields["payload"],
        )


def refuse_credentials(value: object, path: str = "payload") -> None:
    """Raise if anything in here is, or is named like, a credential."""

    if isinstance(value, Mapping):
        for key, item in value.items():
            child = f"{path}.{key}"
            if field_is_sensitive(str(key)):
                raise CredentialInPayload(f"{child} is named like a credential")
            refuse_credentials(item, child)
        return
    if isinstance(value, (list, tuple)):
        for index, item in enumerate(value):
            refuse_credentials(item, f"{path}[{index}]")
        return
    if isinstance(value, str):
        for rule, pattern in CREDENTIAL_SHAPES.items():
            if pattern.search(value):
                raise CredentialInPayload(f"{path} contains something shaped like a {rule}")
