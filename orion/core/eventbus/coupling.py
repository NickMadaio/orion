"""Which subsystem may cause an event in which other subsystem.

"Do not directly couple unrelated systems" survives the obvious protections --
no producer names a consumer, no consumer names a producer, nothing publishes
mid-handling -- and then reappears in the one place that is genuinely useful: a
handler in one category returning an event in another.

That is not a bug. A completed task should be able to raise a notification. So
it is governed rather than banned, in the shape Phase 3 established for context
domains: default deny, and every allowance carries the reason it exists.
"""

from __future__ import annotations

from types import MappingProxyType
from typing import Mapping

from orion.core.eventbus.categories import Category


#: A follow-up may always stay in its own category; these are the crossings.
CASCADES: Mapping[Category, frozenset[Category]] = MappingProxyType(
    {
        Category.CONVERSATION: frozenset({Category.TASKS, Category.MEMORY, Category.NOTIFICATIONS}),
        Category.TASKS: frozenset({Category.MEMORY, Category.NOTIFICATIONS}),
        Category.CALENDAR: frozenset({Category.TASKS, Category.NOTIFICATIONS}),
        Category.EMAIL: frozenset({Category.TASKS, Category.NOTIFICATIONS}),
        Category.HEALTH: frozenset({Category.NOTIFICATIONS}),
        Category.DEVICES: frozenset({Category.SECURITY, Category.NOTIFICATIONS}),
        Category.SECURITY: frozenset({Category.DEVICES, Category.NOTIFICATIONS}),
        Category.AUTOMATION: frozenset({Category.TASKS, Category.NOTIFICATIONS}),
        Category.REMOTE_JOBS: frozenset({Category.TASKS, Category.NOTIFICATIONS}),
        Category.MEMORY: frozenset(),
        # Terminal on purpose. A notification that can cause a notification is a
        # loop waiting for a bad day.
        Category.NOTIFICATIONS: frozenset(),
    }
)

REASONS: Mapping[tuple[Category, Category], str] = MappingProxyType(
    {
        (Category.CONVERSATION, Category.TASKS): "asking for something is how most tasks start",
        (Category.CONVERSATION, Category.MEMORY): "what was said is what there is to remember",
        (Category.CONVERSATION, Category.NOTIFICATIONS): "a reply may need to reach you elsewhere",
        (Category.TASKS, Category.MEMORY): "a finished task is worth remembering",
        (Category.TASKS, Category.NOTIFICATIONS): "you asked to be told when it was done",
        (Category.CALENDAR, Category.TASKS): "an event on the calendar implies work before it",
        (Category.CALENDAR, Category.NOTIFICATIONS): "a change to your day is worth telling you about",
        (Category.EMAIL, Category.TASKS): "a message that needs an answer is a task",
        (Category.EMAIL, Category.NOTIFICATIONS): "some mail cannot wait for you to look",
        (Category.HEALTH, Category.NOTIFICATIONS): "telling you is the only thing health data does on its own",
        (Category.DEVICES, Category.SECURITY): "a device appearing or disappearing is a security fact",
        (Category.DEVICES, Category.NOTIFICATIONS): "you should know when a device pairs",
        (Category.SECURITY, Category.DEVICES): "a security decision can revoke a device",
        (Category.SECURITY, Category.NOTIFICATIONS): "a security event you are not told about is half a control",
        (Category.AUTOMATION, Category.TASKS): "an automation's whole job is to cause work",
        (Category.AUTOMATION, Category.NOTIFICATIONS): "an automation that failed has to say so",
        (Category.REMOTE_JOBS, Category.TASKS): "a job is how a task reaches another device",
        (Category.REMOTE_JOBS, Category.NOTIFICATIONS): "a job that failed on another device has to surface here",
    }
)

#: HEALTH reaches only NOTIFICATIONS, deliberately. Phase 38 makes planning
#: health-aware, and the way to do that is for the PLANNER to consume health
#: events -- not for health to start emitting task events. The difference is
#: whether health data leaves its own subsystem, which is the thing Phase 3's
#: firewall exists to prevent.

#: Two hops is a chain of three subsystems. Anything longer is a design nobody
#: intended, arriving one event at a time.
MAX_CASCADE_DEPTH = 2


def may_cascade(source: Category, target: Category) -> bool:
    if source is target:
        return True
    return target in CASCADES.get(source, frozenset())


def cascade_reason(source: Category, target: Category) -> str | None:
    if source is target:
        return "a subsystem may follow up within itself"
    return REASONS.get((source, target))


def refusal_reason(source: Category, target: Category) -> str:
    return (
        f"a {source.value} handler may not cause a {target.value} event; "
        "cross-subsystem cascades are denied unless explicitly allowed"
    )
