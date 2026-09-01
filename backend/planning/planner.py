"""Deterministic placement, producing suggestions and nothing else.

Two properties this module is built to have, both checkable:

**The same inputs produce the same day.** Not "usually" -- every sort key ends in
the object id, nothing iterates a set, and the plan records the ordered inputs it
was built from so two plans that differ can be told apart from two runs that
differ. The test shuffles the input and asserts the plans are equal.

**A suggestion cannot become a change.** `Suggestion` has no `apply`, `commit` or
`write`. "The planner does not call the write API" is a fact about today's code
that lasts until somebody wires it; having no method to call is a fact about the
type. Phase 25 owns the approval path that turns one into a calendar write, and
it does not exist yet.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone
from enum import Enum

from backend.calendar.availability import Interval, free_slots
from backend.calendar.events import Event
from backend.planning.objects import (
    TIME_WINDOWS,
    PlanningRefused,
    ScheduleObject,
)
from backend.tasks.attributes import Flexibility, PreferredTime


class Unplaceable(str, Enum):
    """Why an object did not make it into the plan. Never silence."""

    BLOCKED = "blocked_by_a_dependency_that_is_not_placed"
    NO_ROOM = "no_free_interval_long_enough"
    PAST_DEADLINE = "every_available_interval_is_after_the_deadline"
    DEADLINE_ALREADY_PASSED = "the_deadline_is_before_the_planning_window"
    CONFLICTS_WITH_FIXED = "its_fixed_time_overlaps_something_else_fixed"


@dataclass(frozen=True, slots=True)
class Placement:
    """One object, at one time, in a proposed day."""

    object_id: str
    interval: Interval
    #: True when the object got the part of day it asked for. Recorded rather
    #: than recomputed, because Phase 24 compares plans and needs to know
    #: whether a move cost the person their preference.
    preference_met: bool


@dataclass(frozen=True, slots=True)
class Skipped:
    object_id: str
    reason: Unplaceable
    detail: str


@dataclass(frozen=True, slots=True)
class Suggestion:
    """A proposed day.

    Deliberately has no method that applies it. Search this class for `apply`,
    `commit`, `write` or `save` and there is nothing to find -- which is the
    manifest's "do not allow automatic schedule changes" as a property of the
    type rather than a promise about call sites.
    """

    window: Interval
    placements: tuple[Placement, ...]
    skipped: tuple[Skipped, ...]
    #: The ids, in the order the planner considered them. Two plans that differ
    #: can then be told apart from two runs of the same plan that differ.
    considered: tuple[str, ...]

    def placement_of(self, object_id: str) -> Placement | None:
        for placement in self.placements:
            if placement.object_id == object_id:
                return placement
        return None

    @property
    def occupied(self) -> tuple[Interval, ...]:
        return tuple(placement.interval for placement in self.placements)


def _preferred_windows(
    obj: ScheduleObject, window: Interval, zone_offset: timedelta
) -> tuple[Interval, ...]:
    """The parts of the planning window matching the object's preferred time.

    `zone_offset` is passed in rather than derived. A part of the day is a
    wall-clock idea and the planner has no business deciding which wall clock;
    the caller knows the person's zone and states it.
    """

    if obj.preferred_time is PreferredTime.ANY:
        return (window,)
    first_hour, last_hour = TIME_WINDOWS[obj.preferred_time]
    local_start = window.start + zone_offset
    day = local_start.replace(hour=0, minute=0, second=0, microsecond=0)
    spans: list[Interval] = []
    for offset in range(0, (window.end - window.start).days + 2):
        base = day + timedelta(days=offset)
        start = (base + timedelta(hours=first_hour)) - zone_offset
        end = (base + timedelta(hours=last_hour)) - zone_offset
        start = max(start, window.start)
        end = min(end, window.end)
        if end > start:
            spans.append(Interval(start=start, end=end))
    return tuple(spans)


def _first_fit(
    slots: Sequence[Interval], duration: timedelta, not_before: datetime | None = None
) -> Interval | None:
    """Earliest interval in `slots` that fits, at or after `not_before`.

    First fit, not best fit. Best fit packs a day tightly and leaves a person
    with no gap anywhere, and the manifest's own instruction about stability
    says the same thing in a different register: a schedule optimised to the
    minute is one that any small change destroys.
    """

    for slot in slots:
        start = slot.start if not_before is None else max(slot.start, not_before)
        if start + duration <= slot.end:
            return Interval(start=start, end=start + duration)
    return None


def _subtract(slots: Sequence[Interval], taken: Interval) -> tuple[Interval, ...]:
    remaining: list[Interval] = []
    for slot in slots:
        if not slot.overlaps(taken):
            remaining.append(slot)
            continue
        if taken.start > slot.start:
            remaining.append(Interval(start=slot.start, end=taken.start))
        if taken.end < slot.end:
            remaining.append(Interval(start=taken.end, end=slot.end))
    return tuple(remaining)


def _dependency_order(
    objects: Sequence[ScheduleObject], satisfied: frozenset[str]
) -> tuple[tuple[ScheduleObject, ...], tuple[ScheduleObject, ...]]:
    """Dependencies before dependents, deterministically.

    `sort_key` orders by flexibility, deadline, priority, duration and id --
    nothing topological. Placing in that order meant a dependent that happened
    to sort BEFORE its dependency was reported BLOCKED with the message "waits
    on X, which is not in this plan", which was false: X was right there,
    further down the list. An independent review found it in 227 of 400 random
    populations; the original test missed it because its two objects had equal
    durations, so the id tiebreak ordered them correctly by luck.

    Kahn's algorithm, taking the `sort_key`-smallest ready object each round so
    the result is still fully determined. Returns what can be ordered and what
    genuinely cannot -- an object whose dependency is not in this set at all,
    or one caught in a cycle.
    """

    remaining = {item.object_id: item for item in objects}
    emitted = set(satisfied)
    order: list[ScheduleObject] = []
    while remaining:
        ready = [
            item
            for item in remaining.values()
            if all(dependency in emitted for dependency in item.depends_on)
        ]
        if not ready:
            break
        chosen = min(ready, key=lambda item: item.sort_key())
        order.append(chosen)
        emitted.add(chosen.object_id)
        del remaining[chosen.object_id]
    return (
        tuple(order),
        tuple(sorted(remaining.values(), key=lambda item: item.sort_key())),
    )


def plan(
    window: Interval,
    objects: Iterable[ScheduleObject],
    *,
    commitments: Iterable[Event] = (),
    zone_offset: timedelta = timedelta(0),
    already_placed: Mapping[str, Interval] | None = None,
) -> Suggestion:
    """Propose a day. Never changes anything.

    FIXED objects and existing calendar commitments occupy the window before
    placement begins; the planner then fits PREFERRED and FLEXIBLE objects into
    what is left, in dependency order and otherwise fully determined.

    `already_placed` names objects that are settled elsewhere and the intervals
    they hold. Phase 24 replans a subset of a day and keeps the rest; without
    this the sub-plan cannot see that a dependency is satisfied, and it deletes
    the dependent from the day with a message saying the dependency is missing.
    """

    ordered = sorted(objects, key=lambda item: item.sort_key())
    by_id = {item.object_id: item for item in ordered}
    if len(by_id) != len(ordered):
        raise PlanningRefused("the same object was given twice")

    placements: list[Placement] = []
    skipped: list[Skipped] = []

    # 1. Existing commitments and fixed objects occupy the window. Fixed objects
    #    are not placed -- their time is part of what they are.
    slots = list(free_slots(window, commitments, minimum=timedelta(minutes=1)))
    for obj in ordered:
        if obj.movable:
            continue
        taken = obj.fixed_at
        if not any(slot.start <= taken.start and taken.end <= slot.end for slot in slots):
            skipped.append(
                Skipped(
                    object_id=obj.object_id,
                    reason=Unplaceable.CONFLICTS_WITH_FIXED,
                    detail=f"{obj.title} is fixed at a time already occupied",
                )
            )
            continue
        slots = list(_subtract(slots, taken))
        placements.append(
            Placement(object_id=obj.object_id, interval=taken, preference_met=True)
        )

    settled: dict[str, Interval] = dict(already_placed or {})
    for placement in placements:
        settled[placement.object_id] = placement.interval

    # 2. Everything movable, in dependency order.
    movable, unreachable = _dependency_order(
        [item for item in ordered if item.movable], frozenset(settled)
    )
    # A dependency that is present but also unreachable means a cycle, not an
    # absence -- and telling somebody their task "waits on X, which is not in
    # this plan" when X is right there is the same false message the ordering
    # bug produced, reached a different way.
    present = set(settled) | {item.object_id for item in movable} | {
        item.object_id for item in unreachable
    }
    for obj in unreachable:
        missing = sorted(
            dependency for dependency in obj.depends_on if dependency not in present
        )
        skipped.append(
            Skipped(
                object_id=obj.object_id,
                reason=Unplaceable.BLOCKED,
                detail=(
                    f"waits on {missing[0]}, which is not in this plan"
                    if missing
                    else "is caught in a dependency cycle, so nothing in it can start"
                ),
            )
        )

    for obj in movable:
        missing = [dep for dep in obj.depends_on if dep not in settled]
        if missing:
            # Scheduling a task before the thing it waits on produces a plan
            # that cannot be executed, which is worse than a gap.
            skipped.append(
                Skipped(
                    object_id=obj.object_id,
                    reason=Unplaceable.BLOCKED,
                    detail=f"waits on {sorted(missing)[0]}, which is not in this plan",
                )
            )
            continue
        if obj.deadline is not None and obj.deadline <= window.start:
            skipped.append(
                Skipped(
                    object_id=obj.object_id,
                    reason=Unplaceable.DEADLINE_ALREADY_PASSED,
                    detail=f"{obj.title} was due before this window opened",
                )
            )
            continue

        not_before = max(
            (settled[dependency].end for dependency in obj.depends_on if dependency in settled),
            default=None,
        )
        chosen, preference_met = _choose(obj, slots, window, zone_offset, not_before)
        if chosen is None:
            skipped.append(
                Skipped(
                    object_id=obj.object_id,
                    reason=Unplaceable.NO_ROOM,
                    detail=f"nothing free for {int(obj.duration.total_seconds() // 60)} minutes",
                )
            )
            continue
        if obj.deadline is not None and chosen.end > obj.deadline:
            # Reported, not placed. A plan that silently misses a deadline is a
            # plan the person believes.
            skipped.append(
                Skipped(
                    object_id=obj.object_id,
                    reason=Unplaceable.PAST_DEADLINE,
                    detail=f"the earliest room is after {obj.deadline.isoformat()}",
                )
            )
            continue
        slots = list(_subtract(slots, chosen))
        placements.append(
            Placement(object_id=obj.object_id, interval=chosen, preference_met=preference_met)
        )
        settled[obj.object_id] = chosen

    placements.sort(key=lambda item: (item.interval.start, item.object_id))
    skipped.sort(key=lambda item: item.object_id)
    return Suggestion(
        window=window,
        placements=tuple(placements),
        skipped=tuple(skipped),
        considered=tuple(item.object_id for item in ordered),
    )


def _choose(
    obj: ScheduleObject,
    slots: Sequence[Interval],
    window: Interval,
    zone_offset: timedelta,
    not_before: datetime | None,
) -> tuple[Interval | None, bool]:
    """Preferred part of day if it fits, anywhere if it does not."""

    if obj.preferred_time is not PreferredTime.ANY:
        preferred = _preferred_windows(obj, window, zone_offset)
        candidates = [
            Interval(start=max(slot.start, span.start), end=min(slot.end, span.end))
            for slot in slots
            for span in preferred
            if min(slot.end, span.end) > max(slot.start, span.start)
        ]
        candidates.sort(key=lambda item: (item.start, item.end))
        chosen = _first_fit(candidates, obj.duration, not_before)
        if chosen is not None:
            return chosen, True
    return _first_fit(slots, obj.duration, not_before), obj.preferred_time is PreferredTime.ANY


def best_placement(
    obj: ScheduleObject,
    slots: Sequence[Interval],
    window: Interval,
    *,
    zone_offset: timedelta = timedelta(0),
    not_before: datetime | None = None,
) -> Placement | None:
    """Where this object would go, given exactly these free intervals.

    Public because Phase 24's improvement pass has to ask the question for one
    object at a time, against the free time left after everything else is
    placed. Re-deriving the choice there would be a second placement rule.
    """

    chosen, preference_met = _choose(obj, slots, window, zone_offset, not_before)
    if chosen is None:
        return None
    if obj.deadline is not None and chosen.end > obj.deadline:
        return None
    return Placement(
        object_id=obj.object_id, interval=chosen, preference_met=preference_met
    )


def unplaceable_reasons(suggestion: Suggestion) -> Mapping[str, str]:
    """What to tell the person about everything that did not fit."""

    return {item.object_id: item.detail for item in suggestion.skipped}
