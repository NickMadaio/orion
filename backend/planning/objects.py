"""What a planner is given, and what it is forbidden to move.

The manifest's three classes are not three priorities. They describe three
relationships between an object and the clock:

- **FIXED** — the time is part of what the thing is. A flight at 06:40 moved to
  09:00 is not the same flight. The planner does not place these; it treats them
  as occupied and plans around them.
- **PREFERRED** — the object wants a time and will take another. A workout at
  six is better than a workout at nine, and both are better than no workout.
- **FLEXIBLE** — only that it happens. Laundry has no opinion.

`Flexibility` is imported from `backend.tasks.attributes` rather than declared
again. Phase 21 recorded that as its follow-up, for the reason that two
definitions is how a task and a schedule object come to disagree about whether a
workout may move.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from backend.calendar.availability import Interval
from backend.tasks.attributes import (
    Energy,
    Flexibility,
    Interruptibility,
    PreferredTime,
    Priority,
    rank_of,
)


class PlanningRefused(ValueError):
    """The planner declined, and the reason names the rule."""


#: The clock ranges each part of the day means. Local wall-clock hours, applied
#: in the person's zone by the caller -- the planner never guesses a zone.
TIME_WINDOWS: dict[PreferredTime, tuple[int, int]] = {
    PreferredTime.EARLY_MORNING: (5, 8),
    PreferredTime.MORNING: (8, 12),
    PreferredTime.AFTERNOON: (12, 17),
    PreferredTime.EVENING: (17, 21),
    PreferredTime.NIGHT: (21, 24),
}


@dataclass(frozen=True, slots=True)
class ScheduleObject:
    """One thing that wants to be somewhere in a day."""

    object_id: str
    title: str
    duration: timedelta
    flexibility: Flexibility
    priority: Priority = Priority.NORMAL
    energy: Energy = Energy.MEDIUM
    interruptibility: Interruptibility = Interruptibility.FREELY
    preferred_time: PreferredTime = PreferredTime.ANY
    deadline: datetime | None = None
    depends_on: tuple[str, ...] = ()
    #: Only a FIXED object has one, and it must: a fixed object whose time is
    #: unknown is not fixed, it is late.
    fixed_at: Interval | None = None

    def __post_init__(self) -> None:
        set_ = object.__setattr__
        for field in ("object_id", "title"):
            value = getattr(self, field)
            if not isinstance(value, str) or not value.strip():
                raise PlanningRefused(f"{field} is required")
        set_(self, "flexibility", Flexibility(self.flexibility))
        set_(self, "priority", Priority(self.priority))
        set_(self, "energy", Energy(self.energy))
        set_(self, "interruptibility", Interruptibility(self.interruptibility))
        set_(self, "preferred_time", PreferredTime(self.preferred_time))
        if not isinstance(self.duration, timedelta) or self.duration <= timedelta(0):
            raise PlanningRefused("a schedule object takes a positive amount of time")
        if self.deadline is not None:
            if not isinstance(self.deadline, datetime) or self.deadline.tzinfo is None:
                raise PlanningRefused("a deadline must carry a timezone")
            set_(self, "deadline", self.deadline.astimezone(timezone.utc))
        if self.flexibility is Flexibility.FIXED:
            if self.fixed_at is None:
                raise PlanningRefused(
                    f"{self.object_id} is FIXED with no time; a fixed object whose "
                    f"time is unknown is not fixed"
                )
            if self.fixed_at.duration != self.duration:
                raise PlanningRefused(
                    "a fixed object's interval and duration disagree about how long it is"
                )
        elif self.fixed_at is not None:
            raise PlanningRefused(
                f"{self.object_id} is {self.flexibility.value} but carries a fixed time"
            )
        dependencies = tuple(self.depends_on)
        if self.object_id in dependencies:
            raise PlanningRefused("an object cannot depend on itself")
        set_(self, "depends_on", dependencies)

    @property
    def movable(self) -> bool:
        return self.flexibility is not Flexibility.FIXED

    def sort_key(self) -> tuple:
        """The deterministic ordering key.

        Ends in `object_id` on purpose. Every other component can tie, and a
        sort that ties produces whatever order the input happened to be in --
        which is how a planner that is called deterministic returns two
        different days for the same day.
        """

        return (
            -rank_of(self.flexibility),
            0 if self.deadline is not None else 1,
            self.deadline or datetime.max.replace(tzinfo=timezone.utc),
            -rank_of(self.priority),
            -self.duration.total_seconds(),
            self.object_id,
        )
