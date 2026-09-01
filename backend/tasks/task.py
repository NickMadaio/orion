"""A task, with the fourteen fields the manifest names.

Fourteen fields is a lot of surface, and the temptation is a dict. A dict is how
`energy_requirement="hi"` reaches Phase 23 and is silently treated as absent, so
every field is typed and every optional field means something specific by being
absent rather than defaulting to a value nobody chose.

The two fields that carry rules rather than data:

- **`estimated_duration` is minutes, and optional.** No estimate is a real state:
  it is what a task captured in three words has, and a planner must be able to
  tell it from an estimate of zero.
- **`actual_duration` cannot be set by the caller at all.** It appears when the
  task completes, computed from what was recorded. It is the only number here
  that is a measurement, and the whole of `estimates.py` is built on nothing
  being able to fabricate it.
"""

from __future__ import annotations

from dataclasses import dataclass, replace
from datetime import datetime, timezone

from backend.tasks.attributes import (
    Energy,
    Flexibility,
    Interruptibility,
    Physical,
    PreferredTime,
    Priority,
    Status,
    TERMINAL,
)


#: The longest a single task may claim to take. Beyond this it is a project, and
#: a planner asked to fit a 30-hour block into a day will either fail loudly or,
#: worse, quietly schedule nothing else forever.
MAX_ESTIMATE_MINUTES = 8 * 60


class TaskRefused(ValueError):
    """The task could not be built or changed, and the reason says which rule."""


def _utc(moment: datetime, field: str) -> datetime:
    if not isinstance(moment, datetime):
        raise TaskRefused(f"{field} must be a datetime")
    if moment.tzinfo is None:
        # A naive datetime is a local time whose zone was thrown away. Phase 17
        # learned this about ordering; a deadline has the same problem and a
        # worse consequence.
        raise TaskRefused(f"{field} must carry a timezone")
    return moment.astimezone(timezone.utc)


def _minutes(value: int | None, field: str) -> int | None:
    if value is None:
        return None
    if type(value) is not int or isinstance(value, bool):
        raise TaskRefused(f"{field} must be whole minutes")
    if value <= 0:
        raise TaskRefused(f"{field} must be more than zero minutes")
    if value > MAX_ESTIMATE_MINUTES:
        raise TaskRefused(f"{field} of {value} minutes is a project, not a task")
    return value


@dataclass(frozen=True, slots=True)
class Task:
    """The manifest's fourteen fields, plus the identity every owned row needs."""

    id: str
    user_id: str
    # 1
    title: str
    # 2
    description: str = ""
    # 3
    deadline: datetime | None = None
    # 4
    estimated_duration: int | None = None
    # 5
    priority: Priority = Priority.NORMAL
    # 6
    energy_requirement: Energy = Energy.MEDIUM
    # 7
    physical_requirement: Physical = Physical.NONE
    # 8
    interruptibility: Interruptibility = Interruptibility.FREELY
    # 9
    location: str | None = None
    # 10
    required_device: str | None = None
    # 11 -- dependencies live in their own table and their own module; the field
    # here is the ids, so a Task is a complete description of itself.
    dependencies: tuple[str, ...] = ()
    # 12
    flexibility: Flexibility = Flexibility.FLEXIBLE
    # 13
    preferred_time: PreferredTime = PreferredTime.ANY
    # 14
    status: Status = Status.OPEN

    started_at: datetime | None = None
    completed_at: datetime | None = None
    actual_duration: int | None = None

    def __post_init__(self) -> None:
        set_ = object.__setattr__
        for field in ("id", "user_id"):
            value = getattr(self, field)
            if not isinstance(value, str) or not value.strip():
                raise TaskRefused(f"{field} is required")
        if not isinstance(self.title, str) or not self.title.strip():
            raise TaskRefused("a task needs a title")
        set_(self, "title", self.title.strip())
        if not isinstance(self.description, str):
            raise TaskRefused("description must be text")

        set_(self, "priority", Priority(self.priority))
        set_(self, "energy_requirement", Energy(self.energy_requirement))
        set_(self, "physical_requirement", Physical(self.physical_requirement))
        set_(self, "interruptibility", Interruptibility(self.interruptibility))
        set_(self, "flexibility", Flexibility(self.flexibility))
        set_(self, "preferred_time", PreferredTime(self.preferred_time))
        set_(self, "status", Status(self.status))

        set_(self, "estimated_duration", _minutes(self.estimated_duration, "estimated_duration"))
        if self.deadline is not None:
            set_(self, "deadline", _utc(self.deadline, "deadline"))
        if self.started_at is not None:
            set_(self, "started_at", _utc(self.started_at, "started_at"))
        if self.completed_at is not None:
            set_(self, "completed_at", _utc(self.completed_at, "completed_at"))

        for field in ("location", "required_device"):
            value = getattr(self, field)
            if value is not None and (not isinstance(value, str) or not value.strip()):
                raise TaskRefused(f"{field} is either a value or absent, never blank")

        dependencies = tuple(self.dependencies)
        if any(not isinstance(item, str) or not item.strip() for item in dependencies):
            raise TaskRefused("a dependency is a task id")
        if len(set(dependencies)) != len(dependencies):
            raise TaskRefused("a dependency is listed twice")
        if self.id in dependencies:
            raise TaskRefused("a task cannot depend on itself")
        set_(self, "dependencies", dependencies)

        # The measurement guard. `actual_duration` is derived from the recorded
        # moments, so a caller cannot hand one in -- which is what the whole of
        # estimates.py assumes when it refuses to call a prediction a
        # measurement.
        if self.actual_duration is not None:
            if self.completed_at is None or self.started_at is None:
                raise TaskRefused("actual_duration exists only on a task that ran and finished")
            measured = round((self.completed_at - self.started_at).total_seconds() / 60)
            if self.actual_duration != max(measured, 1):
                raise TaskRefused("actual_duration must be the measured span, not a supplied number")
        if self.status in TERMINAL and self.completed_at is None:
            raise TaskRefused(f"a {self.status.value} task records when it finished")
        if self.status not in TERMINAL and self.completed_at is not None:
            raise TaskRefused("an unfinished task has no completion time")

    # -- transitions ------------------------------------------------------

    def start(self, at: datetime) -> "Task":
        if self.status is not Status.OPEN:
            raise TaskRefused(f"a {self.status.value} task cannot be started")
        return replace(self, status=Status.IN_PROGRESS, started_at=_utc(at, "at"))

    def complete(self, at: datetime) -> "Task":
        """Finish the task, measuring how long it actually took.

        A task completed without ever being started has no actual duration, and
        that is the honest answer: nothing observed it running. Inventing one
        from `created_at` would make up a measurement.
        """

        if self.status in TERMINAL:
            raise TaskRefused(f"a {self.status.value} task is already finished")
        finished = _utc(at, "at")
        if self.started_at is not None and finished < self.started_at:
            raise TaskRefused("a task cannot finish before it started")
        measured = (
            max(round((finished - self.started_at).total_seconds() / 60), 1)
            if self.started_at is not None
            else None
        )
        return replace(
            self, status=Status.DONE, completed_at=finished, actual_duration=measured
        )

    def drop(self, at: datetime) -> "Task":
        if self.status in TERMINAL:
            raise TaskRefused(f"a {self.status.value} task is already finished")
        return replace(self, status=Status.DROPPED, completed_at=_utc(at, "at"))

    def with_estimate(self, minutes: int | None) -> "Task":
        """Replace the estimate. Never touches `actual_duration`."""

        if self.status in TERMINAL:
            raise TaskRefused("re-estimating a finished task changes nothing that is still true")
        return replace(self, estimated_duration=_minutes(minutes, "estimated_duration"))

    # -- questions --------------------------------------------------------

    @property
    def is_finished(self) -> bool:
        return self.status in TERMINAL

    def overran(self) -> int | None:
        """Minutes over the estimate, or None if either number is missing."""

        if self.actual_duration is None or self.estimated_duration is None:
            return None
        return self.actual_duration - self.estimated_duration
