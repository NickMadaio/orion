"""Estimated versus actual, and letting ORION get better at the first one.

The manifest asks for two things that pull against each other: track how long
tasks actually take, and let ORION improve its estimates over time. Improving an
estimate means writing a number derived from history into the same field a
person may have typed themselves, and if both live in one mutable field then
after one improvement nobody can tell which it is.

So estimates are **records with a basis**, and one basis is structurally
unreachable by anything derived:

    MEASURED  <-- requires a completion time; only a finished task has one
    USER      <-- the person said so
    LEARNED   <-- derived from history, and says so
    DEFAULT   <-- a prior for a task nobody estimated

`Estimate` refuses MEASURED without `measured_from`, and `learn()` has no
completion time to give it. The one number that is ground truth therefore cannot
be synthesised, which is what the rest of this module leans on.
"""

from __future__ import annotations

import statistics
from collections.abc import Iterable, Sequence
from dataclasses import dataclass, replace
from datetime import datetime, timezone
from enum import Enum

from backend.tasks.attributes import Energy, Physical
from backend.tasks.task import MAX_ESTIMATE_MINUTES, Task, TaskRefused


#: How many finished tasks it takes before history is worth listening to.
#: Three, for the reason Phase 18 gives about repeated evidence: one is an
#: anecdote and two is a coincidence. Below this the learner declines rather
#: than producing a confident number nobody earned.
SAMPLE_FLOOR = 3

#: How far a learned correction may move an estimate. A single catastrophic day
#: -- a "20 minute" task that took six hours because the build was broken --
#: should not teach ORION that everything takes eighteen times as long. The
#: clamp is recorded when it fires, because silently capping a correction and
#: reporting the capped number as what history says is a lie about the data.
MIN_FACTOR = 0.5
MAX_FACTOR = 3.0


class Basis(str, Enum):
    """Where a duration number came from."""

    MEASURED = "measured"
    USER = "user"
    LEARNED = "learned"
    DEFAULT = "default"


#: Bases that are predictions. Nothing here may ever be treated as ground truth.
PREDICTED = frozenset({Basis.USER, Basis.LEARNED, Basis.DEFAULT})


class EstimateRefused(TaskRefused):
    """The estimate record was refused, and the reason says which rule."""


@dataclass(frozen=True, slots=True)
class Estimate:
    """One duration number, and the honest account of where it came from."""

    task_id: str
    minutes: int
    basis: Basis
    measured_from: datetime | None = None

    def __post_init__(self) -> None:
        set_ = object.__setattr__
        if not isinstance(self.task_id, str) or not self.task_id.strip():
            raise EstimateRefused("an estimate belongs to a task")
        set_(self, "basis", Basis(self.basis))
        if type(self.minutes) is not int or isinstance(self.minutes, bool):
            raise EstimateRefused("minutes must be whole")
        if self.minutes <= 0:
            raise EstimateRefused("a duration is more than zero minutes")
        if self.minutes > MAX_ESTIMATE_MINUTES:
            raise EstimateRefused(f"{self.minutes} minutes exceeds the task ceiling")

        # The guard the whole module rests on. MEASURED means a task ran and
        # finished, and the completion time is the evidence. Anything derived
        # has no such time to offer, so it cannot claim to be a measurement.
        if self.basis is Basis.MEASURED:
            if self.measured_from is None:
                raise EstimateRefused(
                    "MEASURED requires the completion it was measured from"
                )
            if self.measured_from.tzinfo is None:
                raise EstimateRefused("measured_from must carry a timezone")
            set_(self, "measured_from", self.measured_from.astimezone(timezone.utc))
        elif self.measured_from is not None:
            raise EstimateRefused(
                f"{self.basis.value} is a prediction and cannot cite a measurement"
            )

    @property
    def is_measurement(self) -> bool:
        return self.basis is Basis.MEASURED


def record_measurement(task: Task) -> Estimate:
    """The measured duration of a finished task.

    The only function in the program that produces a MEASURED estimate, and it
    can only do so from a task that actually ran: `Task.complete` leaves
    `actual_duration` as None when nothing observed the task running, and this
    refuses rather than substituting the estimate for the measurement.
    """

    if task.actual_duration is None or task.completed_at is None:
        raise EstimateRefused(
            f"{task.id} has no measured duration -- it was never observed running"
        )
    return Estimate(
        task_id=task.id,
        minutes=task.actual_duration,
        basis=Basis.MEASURED,
        measured_from=task.completed_at,
    )


def bucket_of(task: Task) -> tuple[str, str]:
    """Which group of tasks this one's history belongs with.

    Grouping by title would learn nothing -- every title is unique. Grouping
    everything together would let a person's email habits set the estimate for
    their workouts. So the bucket is the two typed attributes that actually
    predict duration error: how much thinking it wants and how much of the body.
    """

    return (Energy(task.energy_requirement).value, Physical(task.physical_requirement).value)


@dataclass(frozen=True, slots=True)
class Observation:
    """One finished task's estimate against what it took."""

    bucket: tuple[str, str]
    estimated: int
    actual: int

    def __post_init__(self) -> None:
        for field in ("estimated", "actual"):
            value = getattr(self, field)
            if type(value) is not int or isinstance(value, bool) or value <= 0:
                raise EstimateRefused(f"{field} must be whole minutes above zero")

    @property
    def ratio(self) -> float:
        return self.actual / self.estimated


def observations(tasks: Iterable[Task]) -> tuple[Observation, ...]:
    """The finished tasks that can teach anything.

    A task with no estimate teaches nothing about estimating -- there is no
    error to measure -- and a task that never ran has no actual. Both are
    skipped rather than defaulted, because a default here invents the very
    number this module exists to protect.
    """

    return tuple(
        Observation(bucket_of(task), task.estimated_duration, task.actual_duration)
        for task in tasks
        if task.is_finished
        and task.actual_duration is not None
        and task.estimated_duration is not None
    )


@dataclass(frozen=True, slots=True)
class Learning:
    """What history had to say, including when it had nothing to say."""

    bucket: tuple[str, str]
    samples: int
    factor: float
    clamped: bool
    declined: str | None

    @property
    def learned(self) -> bool:
        return self.declined is None


def learn(bucket: tuple[str, str], history: Sequence[Observation]) -> Learning:
    """A correction factor for one bucket, or a recorded refusal to guess.

    The **median** ratio, not the mean. One task that ran six hours over is a
    broken build, not a fact about how long tasks take, and a mean lets it move
    every future estimate. The median needs half the evidence to agree before it
    moves at all.
    """

    relevant = [item for item in history if item.bucket == bucket]
    if len(relevant) < SAMPLE_FLOOR:
        return Learning(
            bucket=bucket,
            samples=len(relevant),
            factor=1.0,
            clamped=False,
            declined=(
                f"{len(relevant)} finished task(s) in this bucket; "
                f"{SAMPLE_FLOOR} are needed before history means anything"
            ),
        )
    raw = statistics.median(item.ratio for item in relevant)
    factor = min(max(raw, MIN_FACTOR), MAX_FACTOR)
    return Learning(
        bucket=bucket,
        samples=len(relevant),
        factor=factor,
        clamped=factor != raw,
        declined=None,
    )


def improve(task: Task, history: Sequence[Observation]) -> tuple[Estimate | None, Learning]:
    """A better estimate for `task`, or None with the reason it was not produced.

    Returns the learning alongside the estimate in every case. A caller that
    only wants the number can ignore it; a caller showing the person why ORION
    changed its mind has the sample count and the factor without asking again.
    """

    learning = learn(bucket_of(task), history)
    if task.estimated_duration is None:
        # Nothing to correct. A factor applied to no estimate is an estimate
        # invented out of other people's tasks.
        return None, Learning(
            bucket=learning.bucket,
            samples=learning.samples,
            factor=learning.factor,
            clamped=learning.clamped,
            declined="the task has no estimate to correct",
        )
    if not learning.learned:
        return None, learning
    raw = round(task.estimated_duration * learning.factor)
    minutes = max(1, min(raw, MAX_ESTIMATE_MINUTES))
    if minutes == task.estimated_duration:
        # THREE cases produce the same number and none of them are the same
        # fact. The first two were distinguished when this was written; the
        # third -- the one-minute floor -- was folded into the ceiling's message
        # by the shared `max(1, min(...))`, so a task history says should take a
        # FIFTH as long was told the ceiling had stopped it. An independent
        # review found it.
        if raw > MAX_ESTIMATE_MINUTES:
            declined = "history says longer than a task may be; the ceiling stopped it, not agreement"
        elif raw < 1:
            declined = "history says shorter than a minute; the floor stopped it, not agreement"
        else:
            declined = "history agrees with the current estimate"
        return None, replace(learning, declined=declined)
    return (
        Estimate(task_id=task.id, minutes=minutes, basis=Basis.LEARNED),
        learning,
    )
