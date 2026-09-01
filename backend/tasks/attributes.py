"""The vocabularies a task is described with.

Every one of these is an enum rather than free text, and that is not tidiness.
Phase 23 has to compare a task's energy requirement against what is left in a
day, and Phase 24 has to decide whether moving something is cheap. Neither can
compare strings a caller invented, and neither should be the place where
"high" and "High" are discovered to be different.

`Flexibility` is the one other phases take a direct dependency on: it is the
manifest's FIXED / PREFERRED / FLEXIBLE classification, defined once here
because a task and a schedule object disagreeing about whether a workout may
move is the defect that classification exists to prevent.
"""

from __future__ import annotations

from enum import Enum


class Status(str, Enum):
    """What a task is doing.

    There is deliberately no BLOCKED. A task is blocked because something else
    is open, and that stops being true the moment the something else closes --
    without anybody telling this module. A stored BLOCKED is a cached answer to
    a question that changes behind its back, so blocking is derived from the
    dependency graph instead. See `dependencies.is_blocked`.
    """

    OPEN = "open"
    IN_PROGRESS = "in_progress"
    DONE = "done"
    DROPPED = "dropped"


#: Statuses a task cannot leave. Reopening a finished task loses the actual
#: duration that finishing it recorded, and that number cannot be recovered.
TERMINAL = frozenset({Status.DONE, Status.DROPPED})


class Priority(str, Enum):
    """Ordered, so a planner can compare two tasks without a lookup table."""

    LOW = "low"
    NORMAL = "normal"
    HIGH = "high"
    CRITICAL = "critical"


class Energy(str, Enum):
    """How much mental capacity the task wants."""

    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class Physical(str, Enum):
    """How much physical capacity the task wants.

    Separate from energy on purpose: a long run is physically demanding and
    mentally restful, and a planner that collapses the two will refuse to
    schedule the run on a day of hard thinking.
    """

    NONE = "none"
    LIGHT = "light"
    MODERATE = "moderate"
    STRENUOUS = "strenuous"


class Interruptibility(str, Enum):
    """Whether the task survives being interrupted."""

    FREELY = "freely"
    COSTLY = "costly"
    NOT_INTERRUPTIBLE = "not_interruptible"


class Flexibility(str, Enum):
    """The manifest's schedule classification, defined once.

    Phase 23 classifies schedule objects as FIXED / PREFERRED / FLEXIBLE. That
    is this. Phase 23 imports these members rather than declaring its own.
    """

    FIXED = "fixed"
    PREFERRED = "preferred"
    FLEXIBLE = "flexible"


class PreferredTime(str, Enum):
    """A part of the day, not a clock time.

    A clock time is a fixed appointment, which is what `deadline` and
    `Flexibility.FIXED` are for. "Mornings, if possible" is a different claim
    and needs somewhere different to live.
    """

    ANY = "any"
    EARLY_MORNING = "early_morning"
    MORNING = "morning"
    AFTERNOON = "afternoon"
    EVENING = "evening"
    NIGHT = "night"


#: Ordering for the ordered vocabularies, so comparison is a lookup rather than
#: a convention each caller reimplements.
RANK: dict[type[Enum], tuple[Enum, ...]] = {
    Priority: (Priority.LOW, Priority.NORMAL, Priority.HIGH, Priority.CRITICAL),
    Energy: (Energy.LOW, Energy.MEDIUM, Energy.HIGH),
    Physical: (Physical.NONE, Physical.LIGHT, Physical.MODERATE, Physical.STRENUOUS),
    Interruptibility: (
        Interruptibility.FREELY,
        Interruptibility.COSTLY,
        Interruptibility.NOT_INTERRUPTIBLE,
    ),
    Flexibility: (Flexibility.FLEXIBLE, Flexibility.PREFERRED, Flexibility.FIXED),
}


def rank_of(value: Enum) -> int:
    """Where `value` sits in its vocabulary, lowest first."""

    order = RANK.get(type(value))
    if order is None:
        raise TypeError(f"{type(value).__name__} is not an ordered vocabulary")
    return order.index(value)
