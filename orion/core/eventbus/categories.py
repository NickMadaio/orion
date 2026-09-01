"""The manifest's eleven event categories, and how sensitive each is by default.

A category is not the same thing as a Phase 3 context domain, and the two are
deliberately not merged. A domain says what a piece of context is ABOUT, so the
firewall can keep health out of an email task. A category says which SUBSYSTEM
produced an event, so the bus can reason about coupling. `remote_jobs` is a
category and not a domain; `credentials` is a domain and must never be a
category, because nothing should be publishing one.
"""

from __future__ import annotations

from enum import Enum
from types import MappingProxyType
from typing import Mapping

from orion.shared.result import Sensitivity


class Category(str, Enum):
    CONVERSATION = "conversation"
    TASKS = "tasks"
    CALENDAR = "calendar"
    EMAIL = "email"
    HEALTH = "health"
    DEVICES = "devices"
    SECURITY = "security"
    AUTOMATION = "automation"
    REMOTE_JOBS = "remote_jobs"
    MEMORY = "memory"
    NOTIFICATIONS = "notifications"


#: What an event of this category is assumed to be, before anything looks at it.
#: A type may declare higher, never lower: a producer that wants its health event
#: treated as merely internal does not get to say so.
DEFAULT_SENSITIVITY: Mapping[Category, Sensitivity] = MappingProxyType(
    {
        Category.CONVERSATION: Sensitivity.SENSITIVE,
        Category.TASKS: Sensitivity.INTERNAL,
        Category.CALENDAR: Sensitivity.SENSITIVE,
        Category.EMAIL: Sensitivity.SENSITIVE,
        Category.HEALTH: Sensitivity.RESTRICTED,
        Category.DEVICES: Sensitivity.INTERNAL,
        Category.SECURITY: Sensitivity.RESTRICTED,
        Category.AUTOMATION: Sensitivity.INTERNAL,
        Category.REMOTE_JOBS: Sensitivity.INTERNAL,
        Category.MEMORY: Sensitivity.SENSITIVE,
        Category.NOTIFICATIONS: Sensitivity.INTERNAL,
    }
)

_ORDER = (
    Sensitivity.PUBLIC,
    Sensitivity.INTERNAL,
    Sensitivity.SENSITIVE,
    Sensitivity.RESTRICTED,
)


def at_least_as_sensitive(declared: Sensitivity, floor: Sensitivity) -> bool:
    return _ORDER.index(declared) >= _ORDER.index(floor)


def floor_for(category: Category) -> Sensitivity:
    return DEFAULT_SENSITIVITY[category]
