"""Registered event types, each with a version the bus enforces.

An envelope whose (type, version) pair is not here does not publish. A version
field nothing checks is decoration; this one is why a consumer can say which
versions it accepts and be believed.

The seed set covers all eleven categories. It is not meant to be complete --
later phases add their own types -- but every category has at least one, because
a category with no type is a name in an enum rather than part of a system.
"""

from __future__ import annotations

from dataclasses import dataclass
from types import MappingProxyType
from typing import Mapping

from orion.core.eventbus.categories import Category, at_least_as_sensitive, floor_for
from orion.shared.result import Sensitivity


@dataclass(frozen=True, slots=True)
class EventType:
    name: str
    version: int
    sensitivity: Sensitivity
    required_payload: tuple[str, ...]
    description: str

    def __post_init__(self) -> None:
        if type(self.version) is not int or self.version < 1:
            raise ValueError(f"{self.name}: version must be a positive integer")
        object.__setattr__(self, "sensitivity", Sensitivity(self.sensitivity))
        if not at_least_as_sensitive(self.sensitivity, floor_for(self.category)):
            raise ValueError(f"{self.name} is less sensitive than its category permits")
        if not self.description:
            raise ValueError(f"{self.name}: an event type must say what it means")

    @property
    def category(self) -> Category:
        return Category(self.name.split(".", 1)[0])


def _types(*entries: EventType) -> Mapping[tuple[str, int], EventType]:
    registry: dict[tuple[str, int], EventType] = {}
    for entry in entries:
        key = (entry.name, entry.version)
        if key in registry:
            raise ValueError(f"{entry.name} v{entry.version} is registered twice")
        registry[key] = entry
    return MappingProxyType(registry)


S = Sensitivity

REGISTRY = _types(
    EventType("conversation.turn_recorded", 1, S.SENSITIVE, ("turn_id",), "A turn was added to a conversation."),
    EventType("conversation.session_started", 1, S.SENSITIVE, ("session_id",), "A conversation session began."),
    EventType("tasks.created", 1, S.INTERNAL, ("task_id",), "A task was created."),
    EventType("tasks.completed", 1, S.INTERNAL, ("task_id",), "A task finished successfully."),
    EventType("tasks.failed", 1, S.INTERNAL, ("task_id", "reason"), "A task failed."),
    EventType("calendar.event_observed", 1, S.SENSITIVE, ("event_id",), "A calendar event was read."),
    EventType("calendar.event_written", 1, S.SENSITIVE, ("event_id",), "A calendar event was created or changed."),
    EventType("email.message_observed", 1, S.SENSITIVE, ("message_id",), "A message was read."),
    EventType("email.draft_created", 1, S.SENSITIVE, ("draft_id",), "A draft was written but not sent."),
    EventType("health.state_changed", 1, S.RESTRICTED, ("day",), "The daily health state changed."),
    EventType("health.metric_recorded", 1, S.RESTRICTED, ("metric",), "A health metric was recorded."),
    EventType("devices.paired", 1, S.INTERNAL, ("device_id",), "A device completed pairing."),
    EventType("devices.revoked", 1, S.INTERNAL, ("device_id",), "A device was revoked."),
    EventType("devices.status_changed", 1, S.INTERNAL, ("device_id", "status"), "A device changed status."),
    EventType("security.policy_decided", 1, S.RESTRICTED, ("outcome", "capability"), "The policy engine decided."),
    EventType("security.profile_changed", 1, S.RESTRICTED, ("profile",), "The permission profile changed."),
    EventType("security.lock_engaged", 1, S.RESTRICTED, ("reason",), "ORION was locked."),
    EventType("automation.run_started", 1, S.INTERNAL, ("automation_id", "run_id"), "An automation started."),
    EventType("automation.run_finished", 1, S.INTERNAL, ("automation_id", "run_id", "status"), "An automation finished."),
    EventType("remote_jobs.job_created", 1, S.INTERNAL, ("job_id",), "A job was created for a device."),
    EventType("remote_jobs.job_state_changed", 1, S.INTERNAL, ("job_id", "status"), "A job changed state."),
    EventType("memory.item_written", 1, S.SENSITIVE, ("item_id",), "Something was written to memory."),
    EventType("memory.item_recalled", 1, S.SENSITIVE, ("item_id",), "Something was recalled from memory."),
    EventType("notifications.raised", 1, S.INTERNAL, ("notification_id",), "A notification was raised."),
    EventType("notifications.delivered", 1, S.INTERNAL, ("notification_id", "channel"), "A notification was delivered."),
)


def registered(name: str, version: int) -> EventType | None:
    return REGISTRY.get((name, version))


def versions_of(name: str) -> tuple[int, ...]:
    return tuple(sorted(version for (event, version) in REGISTRY if event == name))


def in_category(category: Category) -> tuple[EventType, ...]:
    return tuple(entry for entry in REGISTRY.values() if entry.category is category)
