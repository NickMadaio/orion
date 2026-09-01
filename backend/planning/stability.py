"""What it costs to move something already planned, and when it is worth it.

A planner that re-optimises from scratch produces a better day every time and a
different day every time. The person, who already decided to run at six, watches
their morning rearrange because a task acquired a deadline — and stops trusting
the plan, which costs more than the optimisation gained.

So stability is not a tiebreak applied at the end. **Moving an already-placed
item carries a cost the improvement has to beat**, and the comparison is recorded
so a person can be told what moved and what the move bought.

## The nine inputs

The manifest names nine things to consider. Each is read by a named function
here, and `READS` maps them so a test fails if one stops being consulted:

| input | where |
|---|---|
| deadline | `score_placement` — slack before the deadline |
| importance | `score_placement` — priority weight |
| duration | `change_cost` — a three-hour block moved is more disruptive than fifteen minutes |
| dependencies | `planner.plan` — a hard constraint, not a score |
| energy requirement | `score_placement` — against the caller's energy profile |
| existing commitments | `planner.plan` — occupied before placement |
| preferred time | `score_placement` — `Placement.preference_met` |
| previous schedule | `change_cost` — there is no cost without one |
| change cost | `worth_moving` — the comparison itself |
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from datetime import datetime, timedelta, timezone

from backend.calendar.availability import Interval
from backend.calendar.events import Event
from backend.planning.objects import PlanningRefused, ScheduleObject
from backend.planning.planner import Placement, Suggestion, best_placement, plan
from backend.tasks.attributes import Energy, Flexibility, PreferredTime, Priority, rank_of


#: What each class of object costs to move, before distance. A FLEXIBLE errand
#: reordered is nearly free; a PREFERRED workout the person deliberately put at
#: six is not.
CLASS_COST = {Flexibility.FLEXIBLE: 1.0, Flexibility.PREFERRED: 8.0}

#: Per minute of displacement, and the ceiling it reaches within a day.
PER_MINUTE = 0.02
WITHIN_DAY_CAP = 12.0

#: Crossing into another day. Larger than the distance cap plus the largest
#: class cost, so for the SAME object a day crossing always costs strictly more
#: than any within-day move -- which is what matters, because `day_boundary_cost`
#: is additive on top of the same distance and duration terms.
#:
#: It is NOT larger than every conceivable within-day total: a very long object
#: shoved a long way can exceed 40 through its duration term alone. The comment
#: used to claim otherwise, and the test that would have caught it computed the
#: number and never asserted on it.
DAY_BOUNDARY = 40.0

#: Longer things are more disruptive to move: a three-hour block displaces
#: everything around it, a fifteen-minute one moves inside a gap.
PER_HOUR_OF_DURATION = 1.5

READS: Mapping[str, str] = {
    "deadline": "score_placement",
    "importance": "score_placement",
    "duration": "change_cost",
    "dependencies": "planner.plan",
    "energy_requirement": "score_placement",
    "existing_commitments": "planner.plan",
    "preferred_time": "score_placement",
    "previous_schedule": "change_cost",
    "change_cost": "worth_moving",
}


class MoveRefused(PlanningRefused):
    """A FIXED object was asked to move."""


#: A default energy curve is deliberately absent. When a person has energy is
#: the most individual thing in this file, and a planner that assumes mornings
#: will schedule a night owl's hardest work at eight for the rest of their life.
#: The caller supplies one; `flat_profile()` is the honest "nobody said".
def flat_profile() -> Mapping[PreferredTime, Energy]:
    return {part: Energy.MEDIUM for part in PreferredTime}


@dataclass(frozen=True, slots=True)
class ChangeCost:
    """What moving one object costs, broken into the parts that caused it."""

    object_id: str
    class_cost: float
    distance_cost: float
    duration_cost: float
    day_boundary_cost: float

    @property
    def total(self) -> float:
        return self.class_cost + self.distance_cost + self.duration_cost + self.day_boundary_cost


def change_cost(
    obj: ScheduleObject,
    previous: Interval,
    proposed: Interval,
    *,
    zone_offset: timedelta = timedelta(0),
    previously_satisfied: bool = True,
) -> ChangeCost:
    """The cost of moving `obj` from where it was to where it is proposed.

    Reads **duration** and the **previous schedule**, which are two of the
    manifest's nine. Refuses a FIXED object outright rather than pricing it: a
    price implies something could pay it.

    `previously_satisfied` is what stops PREFERRED from collapsing into
    FLEXIBLE. The class cost prices **disturbing a decision** -- a workout the
    person put at six. If the object is not currently at its preferred time,
    then where it sits is the *planner's own* fallback, not the person's
    choice, and moving it toward the preference is the planner correcting
    itself. So the premium applies only when the current placement actually met
    the preference; otherwise there is no decision there to disturb.
    """

    if obj.flexibility is Flexibility.FIXED:
        raise MoveRefused(
            f"{obj.object_id} is FIXED; its time is part of what it is, and it has no price"
        )
    if previous == proposed:
        return ChangeCost(obj.object_id, 0.0, 0.0, 0.0, 0.0)
    displacement = abs((proposed.start - previous.start).total_seconds()) / 60
    distance = min(displacement * PER_MINUTE, WITHIN_DAY_CAP)
    crossed = (previous.start + zone_offset).date() != (proposed.start + zone_offset).date()
    premium = obj.flexibility is Flexibility.PREFERRED and previously_satisfied
    return ChangeCost(
        object_id=obj.object_id,
        class_cost=CLASS_COST[Flexibility.PREFERRED if premium else Flexibility.FLEXIBLE],
        distance_cost=distance,
        duration_cost=(obj.duration.total_seconds() / 3600) * PER_HOUR_OF_DURATION,
        day_boundary_cost=DAY_BOUNDARY if crossed else 0.0,
    )


#: How much each priority level is worth having placed at all.
PRIORITY_VALUE = {
    Priority.LOW: 4.0,
    Priority.NORMAL: 10.0,
    Priority.HIGH: 22.0,
    Priority.CRITICAL: 60.0,
}
PREFERENCE_VALUE = 12.0
ENERGY_FIT_VALUE = 5.0
#: Value for finishing well before a deadline, per hour of slack, capped -- a
#: task done three days early is not thirty times better than one done two hours
#: early, and without a cap the score becomes "do everything immediately".
PER_HOUR_OF_SLACK = 0.4
SLACK_CAP = 8.0


def _part_of_day(moment: datetime, zone_offset: timedelta) -> PreferredTime:
    hour = (moment + zone_offset).hour
    if 5 <= hour < 8:
        return PreferredTime.EARLY_MORNING
    if 8 <= hour < 12:
        return PreferredTime.MORNING
    if 12 <= hour < 17:
        return PreferredTime.AFTERNOON
    if 17 <= hour < 21:
        return PreferredTime.EVENING
    return PreferredTime.NIGHT


def score_placement(
    obj: ScheduleObject,
    placement: Placement,
    *,
    energy_profile: Mapping[PreferredTime, Energy] | None = None,
    zone_offset: timedelta = timedelta(0),
) -> float:
    """What this placement is worth.

    Reads **importance**, **preferred time**, **deadline** and **energy
    requirement** -- four of the manifest's nine.
    """

    profile = energy_profile if energy_profile is not None else flat_profile()
    value = PRIORITY_VALUE[obj.priority]
    if placement.preference_met:
        value += PREFERENCE_VALUE
    available = profile.get(_part_of_day(placement.interval.start, zone_offset), Energy.MEDIUM)
    if rank_of(available) >= rank_of(obj.energy):
        value += ENERGY_FIT_VALUE
    if obj.deadline is not None:
        slack_hours = max((obj.deadline - placement.interval.end).total_seconds() / 3600, 0)
        value += min(slack_hours * PER_HOUR_OF_SLACK, SLACK_CAP)
    return value


def score_plan(
    suggestion: Suggestion,
    objects: Mapping[str, ScheduleObject],
    *,
    energy_profile: Mapping[PreferredTime, Energy] | None = None,
    zone_offset: timedelta = timedelta(0),
) -> float:
    return sum(
        score_placement(
            objects[placement.object_id],
            placement,
            energy_profile=energy_profile,
            zone_offset=zone_offset,
        )
        for placement in suggestion.placements
        if placement.object_id in objects
    )


@dataclass(frozen=True, slots=True)
class Move:
    """One object that would move, and whether the move earns its keep."""

    object_id: str
    was: Interval
    becomes: Interval
    improvement: float
    cost: ChangeCost

    @property
    def worthwhile(self) -> bool:
        return self.improvement > self.cost.total


def worth_moving(
    obj: ScheduleObject,
    was: Placement,
    becomes: Placement,
    *,
    energy_profile: Mapping[PreferredTime, Energy] | None = None,
    zone_offset: timedelta = timedelta(0),
) -> Move:
    """Whether a proposed move beats what it costs.

    This is the comparison the manifest asks for, made explicit rather than
    implied by an objective function. **Strictly greater**: a move that exactly
    breaks even does not happen, because the tie should go to the day the person
    already has.
    """

    improvement = score_placement(
        obj, becomes, energy_profile=energy_profile, zone_offset=zone_offset
    ) - score_placement(obj, was, energy_profile=energy_profile, zone_offset=zone_offset)
    return Move(
        object_id=obj.object_id,
        was=was.interval,
        becomes=becomes.interval,
        improvement=improvement,
        cost=change_cost(
            obj,
            was.interval,
            becomes.interval,
            zone_offset=zone_offset,
            previously_satisfied=was.preference_met,
        ),
    )


@dataclass(frozen=True, slots=True)
class Replan:
    """A new day, and an account of what it cost to get there.

    Three things can happen to an already-placed object, and conflating them is
    the defect this class exists to prevent:

    - **kept** — its placement is still valid and it was never reconsidered;
    - **relocated** — its placement became invalid (the window shrank, a meeting
      appeared), so it *had* to move. The cost is recorded but does not veto:
      vetoing a forced move deletes the object from the day;
    - **moved** — its placement was still perfectly valid and the planner found
      something better. This is the only case the cost may veto, and the only
      one that means the day was rearranged rather than repaired.
    """

    suggestion: Suggestion
    kept: tuple[str, ...]
    moved: tuple[Move, ...]
    relocated: tuple[Move, ...]
    #: FIXED objects whose own time changed. Not a move ORION made and not
    #: priced: the flight moved, ORION re-occupied the new hour.
    refixed: tuple[str, ...]
    declined: tuple[Move, ...]
    added: tuple[str, ...]

    @property
    def stable(self) -> bool:
        """Nothing moved that did not have to.

        Relocations do not count. Being pushed out of a slot a new meeting took
        is the plan being repaired, not the planner rearranging the day.
        """

        return not self.moved


def replan(
    previous: Suggestion,
    window: Interval,
    objects: Iterable[ScheduleObject],
    *,
    commitments: Iterable[Event] = (),
    energy_profile: Mapping[PreferredTime, Energy] | None = None,
    zone_offset: timedelta = timedelta(0),
) -> Replan:
    """Fit what changed into the day that already exists.

    The rule that keeps a small change small: an object whose previous placement
    is **still valid** is kept without being reconsidered. The planner is not
    choosing to leave the rest of the day alone; it is never asked about it.

    Then one improvement pass, and only over kept objects, offering each the
    free time that is left. That is where the change cost actually bites -- and
    it is deliberately a second pass rather than part of placement, so that
    "would this be better elsewhere" is a question with a price attached instead
    of an objective function that reshuffles everything to answer it.
    """

    ordered = sorted(objects, key=lambda item: item.sort_key())
    by_id = {item.object_id: item for item in ordered}
    if len(by_id) != len(ordered):
        raise PlanningRefused("the same object was given twice")

    kept: list[Placement] = []
    needs_placement: list[ScheduleObject] = []
    for obj in ordered:
        placement = previous.placement_of(obj.object_id)
        if placement is None or not _still_valid(obj, placement, window, kept, commitments):
            needs_placement.append(obj)
            continue
        kept.append(placement)

    # Kept placements are passed BOTH as occupied time and as settled ids.
    # Passing only the time meant the sub-plan could not see that a dependency
    # was satisfied, so it reported the dependent BLOCKED and deleted it from
    # the day -- after nothing worse than a thirty-minute meeting. An
    # independent review reproduced that in 20 of 400 random populations, and
    # it is the exact failure "avoid reshuffling the user's day" exists to
    # prevent.
    fresh = plan(
        window,
        needs_placement,
        commitments=tuple(commitments)
        + _as_blockers(tuple(item.interval for item in kept)),
        zone_offset=zone_offset,
        already_placed={item.object_id: item.interval for item in kept},
    )

    relocated: list[Move] = []
    refixed: list[str] = []
    added: list[str] = []
    final: list[Placement] = list(kept)
    for placement in fresh.placements:
        obj = by_id[placement.object_id]
        before = previous.placement_of(placement.object_id)
        final.append(placement)
        if before is None:
            added.append(placement.object_id)
            continue
        if not obj.movable:
            # The flight moved; ORION did not move the flight. Pricing this
            # would mean calling `change_cost` on a FIXED object, which refuses
            # -- correctly -- and took the whole replan down with it.
            if before.interval != placement.interval:
                refixed.append(placement.object_id)
            continue
        # Forced. Its old slot is gone, so the alternative to moving is not
        # staying -- it is disappearing from the day.
        relocated.append(
            worth_moving(
                obj, before, placement,
                energy_profile=energy_profile, zone_offset=zone_offset,
            )
        )

    moved, declined, final = _improvement_pass(
        final,
        by_id,
        window,
        commitments=commitments,
        energy_profile=energy_profile,
        zone_offset=zone_offset,
    )
    kept_ids = tuple(
        sorted(
            {item.object_id for item in kept}
            - {move.object_id for move in moved}
        )
    )

    final.sort(key=lambda item: (item.interval.start, item.object_id))
    return Replan(
        suggestion=Suggestion(
            window=window,
            placements=tuple(final),
            skipped=fresh.skipped,
            considered=tuple(item.object_id for item in ordered),
        ),
        kept=kept_ids,
        moved=tuple(sorted(moved, key=lambda item: item.object_id)),
        relocated=tuple(sorted(relocated, key=lambda item: item.object_id)),
        refixed=tuple(sorted(refixed)),
        declined=tuple(sorted(declined, key=lambda item: item.object_id)),
        added=tuple(sorted(added)),
    )


def _improvement_pass(
    placements: Sequence[Placement],
    by_id: Mapping[str, ScheduleObject],
    window: Interval,
    *,
    commitments: Iterable[Event],
    energy_profile: Mapping[PreferredTime, Energy] | None,
    zone_offset: timedelta,
) -> tuple[list[Move], list[Move], list[Placement]]:
    """Offer each placed object the free time left, and price the swap.

    Only objects whose preference is currently **unmet** are asked. An object
    that already has what it wanted has nothing to gain and asking anyway is how
    a stable planner becomes a churning one -- every pass finding some
    fractional improvement worth a fractional cost.
    """

    from backend.calendar.availability import free_slots

    current = {item.object_id: item for item in placements}
    moved: list[Move] = []
    declined: list[Move] = []
    for placement in sorted(placements, key=lambda item: item.object_id):
        obj = by_id.get(placement.object_id)
        if obj is None or not obj.movable or placement.preference_met:
            continue
        others = tuple(
            item.interval for item in current.values()
            if item.object_id != placement.object_id
        )
        slots = free_slots(
            window,
            tuple(commitments) + _as_blockers(others),
            minimum=timedelta(minutes=1),
        )
        # Dependencies bound the move in BOTH directions, and the improvement
        # pass had neither. `plan` computes a `not_before` from an object's
        # dependencies; this path did not, so it was free to move a dependent
        # to four hours BEFORE the thing it waits on -- a hard constraint the
        # gate calls "a constraint, not a score", broken on the only path that
        # can change a placement.
        not_before = max(
            (
                current[dependency].interval.end
                for dependency in obj.depends_on
                if dependency in current
            ),
            default=None,
        )
        # And moving something earlier can strand its dependents.
        dependents = [
            item
            for item in current.values()
            if placement.object_id in (by_id[item.object_id].depends_on if item.object_id in by_id else ())
        ]
        not_after = min((item.interval.start for item in dependents), default=None)

        candidate = best_placement(
            obj, slots, window, zone_offset=zone_offset, not_before=not_before
        )
        if candidate is None or candidate.interval == placement.interval:
            continue
        if not_after is not None and candidate.interval.end > not_after:
            continue
        move = worth_moving(
            obj, placement, candidate,
            energy_profile=energy_profile, zone_offset=zone_offset,
        )
        if move.worthwhile:
            moved.append(move)
            current[placement.object_id] = candidate
        else:
            declined.append(move)
    return moved, declined, list(current.values())


def _still_valid(
    obj: ScheduleObject,
    placement: Placement,
    window: Interval,
    kept: Sequence[Placement],
    commitments: Iterable[Event],
) -> bool:
    interval = placement.interval
    if not obj.movable and interval != obj.fixed_at:
        # A FIXED object's time is part of what it is. If the flight moved, the
        # old placement is not "still valid" -- it is a stale copy of a fact
        # that changed, and keeping it reported the day as stable at the wrong
        # hour.
        return False
    if interval.start < window.start or interval.end > window.end:
        return False
    if interval.duration != obj.duration:
        return False
    if obj.deadline is not None and interval.end > obj.deadline:
        return False
    if any(interval.overlaps(other.interval) for other in kept):
        return False
    from backend.calendar.availability import conflicts

    return not conflicts(interval, tuple(commitments))


def _as_blockers(intervals: Sequence[Interval]) -> tuple[Event, ...]:
    """Kept placements, as occupied time the sub-plan must not use."""

    from backend.calendar.events import Transparency

    return tuple(
        Event(
            event_id=f"__held_{index}",
            calendar_id="__plan",
            summary="held",
            starts_at=interval.start,
            ends_at=interval.end,
            transparency=Transparency.OPAQUE,
        )
        for index, interval in enumerate(intervals)
    )
