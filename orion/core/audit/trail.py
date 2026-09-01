"""One event in, two records out: the developer log and the user-facing one.

The separation the manifest asks for is a rendering split, not a second write
path. Both records come from the same event, so they cannot drift apart, and the
event has already been through the redactor before it reaches here -- there is
no way to construct one that has not.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Protocol, runtime_checkable

from orion.core.audit.events import AuditEvent
from orion.core.audit.narrative import describe
from orion.shared.identifiers import Identifier
from orion.shared.result import Sensitivity


@dataclass(frozen=True, slots=True)
class UserFacingEntry:
    """What a person sees in the security centre.

    No identifiers, no reason codes, no schema version. If it needs an
    explanation to read, it belongs in the developer record.
    """

    occurred_at: datetime
    sentence: str
    sensitivity: Sensitivity

    def __post_init__(self) -> None:
        if not isinstance(self.sentence, str) or not self.sentence:
            raise ValueError("a user-facing entry must say something")
        object.__setattr__(self, "sensitivity", Sensitivity(self.sensitivity))


@runtime_checkable
class DeveloperSink(Protocol):
    def append(self, payload: dict[str, object]) -> Identifier: ...


@runtime_checkable
class UserFacingSink(Protocol):
    def append(self, entry: UserFacingEntry) -> Identifier: ...


class SecureDebugRefused(ValueError):
    """A secure-debug event reached a trail that is not in secure-debug mode.

    Its own type because it is not a validation error: the record is well
    formed, and the objection is that it carries a conversation to a place that
    has not been authorized to keep one.
    """


class AuditTrail:
    def __init__(
        self,
        developer: DeveloperSink,
        user_facing: UserFacingSink,
        *,
        secure_debug: bool = False,
    ) -> None:
        self._developer = developer
        self._user_facing = user_facing
        self._secure_debug = bool(secure_debug)

    @property
    def secure_debug(self) -> bool:
        return self._secure_debug

    def record(self, event: AuditEvent) -> Identifier:
        """Write both records and return the event id.

        The developer sink is written first. If the user-facing render fails,
        the evidence still exists; if the order were reversed, a rendering bug
        would silently cost the audit record.
        """

        if not isinstance(event, AuditEvent):
            raise ValueError("record takes an AuditEvent")
        if event.secure_debug and not self._secure_debug:
            raise SecureDebugRefused(
                "this trail does not accept records captured in secure-debug mode"
            )
        self._developer.append(event.to_dict())
        self._user_facing.append(
            UserFacingEntry(
                occurred_at=event.occurred_at,
                sentence=describe(event),
                sensitivity=event.sensitivity,
            )
        )
        return event.event_id


class InMemorySink:
    """A sink for tests and for anything that has not chosen storage yet.

    Core performs no I/O -- writing to a file is the adapter's job, and the live
    ledgers remain the durable evidence until the migration this phase records
    but does not perform.
    """

    def __init__(self) -> None:
        self.entries: list[object] = []

    def append(self, payload: object) -> Identifier:
        self.entries.append(payload)
        identifier = payload.get("event_id") if isinstance(payload, dict) else None
        return Identifier(identifier) if isinstance(identifier, str) else Identifier("audit-in-memory")

    def __len__(self) -> int:
        return len(self.entries)
