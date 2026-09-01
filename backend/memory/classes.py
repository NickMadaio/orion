"""The four memory classes, which are really four lifetimes.

The manifest names them; what makes them different is how long they last and what
it takes to get in. Written as data because "which of these is durable" is a
question the promotion gate asks and should not have to guess at.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import timedelta
from enum import Enum
from types import MappingProxyType
from typing import Mapping


class MemoryClass(str, Enum):
    #: This conversation. Gone in hours.
    WORKING = "working"
    #: What happened. A record of an event, not a claim about the world.
    EPISODIC = "episodic"
    #: Facts about the person. The most dangerous class.
    USER = "user"
    #: Knowledge about a subject, not about the person.
    DOMAIN = "domain"


@dataclass(frozen=True, slots=True)
class ClassRules:
    durable: bool
    requires_grounds: bool
    default_lifetime: timedelta | None
    user_editable_by_default: bool
    note: str


CLASS_RULES: Mapping[MemoryClass, ClassRules] = MappingProxyType(
    {
        MemoryClass.WORKING: ClassRules(
            durable=False, requires_grounds=False, default_lifetime=timedelta(hours=12),
            user_editable_by_default=True,
            note="Scratch space for a conversation. Nothing here outlives the day.",
        ),
        MemoryClass.EPISODIC: ClassRules(
            durable=True, requires_grounds=False, default_lifetime=timedelta(days=365),
            user_editable_by_default=False,
            note=(
                "A record of what happened. Durable without grounds because it claims nothing about "
                "the world -- only that an event occurred -- and not editable because it is evidence."
            ),
        ),
        MemoryClass.USER: ClassRules(
            durable=True, requires_grounds=True, default_lifetime=None,
            user_editable_by_default=True,
            note=(
                "Facts about the person. Requires grounds, and is editable and deletable by them, "
                "because a wrong permanent belief about somebody is the worst thing here."
            ),
        ),
        MemoryClass.DOMAIN: ClassRules(
            durable=True, requires_grounds=True, default_lifetime=timedelta(days=730),
            user_editable_by_default=True,
            note="Knowledge about a subject. Requires grounds; expires eventually because knowledge goes stale.",
        ),
    }
)


def rules_for(memory_class: MemoryClass) -> ClassRules:
    return CLASS_RULES[MemoryClass(memory_class)]


def is_durable(memory_class: MemoryClass) -> bool:
    return rules_for(memory_class).durable
