"""Phases 23 and 24: deterministic planning, and the cost of moving what is planned.

The properties under test, rather than the happy path:

- the same inputs in any order produce the same day;
- a suggestion has no way to become a change;
- adding one task does not rearrange the day;
- a move happens only when the improvement beats the cost.
"""

from __future__ import annotations

import random
import unittest
from dataclasses import replace
from datetime import datetime, timedelta, timezone

from backend.calendar.availability import Interval
from backend.calendar.events import Event, Transparency
from backend.planning import objects as objs
from backend.planning import stability as stab
from backend.planning.objects import TIME_WINDOWS, PlanningRefused, ScheduleObject
from backend.planning.planner import (
    Suggestion,
    Unplaceable,
    plan,
    unplaceable_reasons,
)
from backend.tasks.attributes import (
    Energy,
    Flexibility,
    Interruptibility,
    PreferredTime,
    Priority,
)


def at(hour: int, minute: int = 0, day: int = 26) -> datetime:
    return datetime(2026, 8, day, hour, minute, tzinfo=timezone.utc)


def span(start_hour: int, end_hour: int, day: int = 26) -> Interval:
    return Interval(start=at(start_hour, day=day), end=at(end_hour, day=day))


WINDOW = span(9, 17)


def obj(object_id: str, hours: float = 1, **kwargs) -> ScheduleObject:
    base = {
        "object_id": object_id,
        "title": f"Task {object_id}",
        "duration": timedelta(hours=hours),
        "flexibility": Flexibility.FLEXIBLE,
    }
    base.update(kwargs)
    return ScheduleObject(**base)


def busy(event_id: str, start_hour: int, end_hour: int) -> Event:
    return Event(
        event_id=event_id,
        calendar_id="cal1",
        summary="Meeting",
        starts_at=at(start_hour),
        ends_at=at(end_hour),
        transparency=Transparency.OPAQUE,
    )


class ThreeClassesTests(unittest.TestCase):
    def test_the_classes_come_from_phase_21_rather_than_being_redeclared(self):
        # Phase 21's recorded follow-up. Two definitions is how a task and a
        # schedule object come to disagree about whether a workout may move.
        import backend.tasks.attributes as attributes

        self.assertIs(objs.Flexibility, attributes.Flexibility)
        self.assertEqual(
            {member.value for member in Flexibility}, {"fixed", "preferred", "flexible"}
        )

    def test_a_fixed_object_must_know_its_time(self):
        with self.assertRaises(PlanningRefused):
            obj("f", flexibility=Flexibility.FIXED)

    def test_a_movable_object_may_not_carry_a_fixed_time(self):
        with self.assertRaises(PlanningRefused):
            obj("a", flexibility=Flexibility.PREFERRED, fixed_at=span(10, 11))

    def test_a_fixed_objects_interval_must_match_its_duration(self):
        with self.assertRaises(PlanningRefused):
            obj("f", hours=1, flexibility=Flexibility.FIXED, fixed_at=span(10, 12))

    def test_fixed_is_occupied_rather_than_placed(self):
        fixed = obj("f", flexibility=Flexibility.FIXED, fixed_at=span(10, 11))
        suggestion = plan(WINDOW, [fixed, obj("a", hours=2)])
        self.assertEqual(suggestion.placement_of("f").interval, span(10, 11))
        # The flexible object went around it, not through it.
        placed = suggestion.placement_of("a").interval
        self.assertFalse(placed.overlaps(span(10, 11)))

    def test_two_fixed_objects_at_the_same_time_report_the_conflict(self):
        first = obj("f1", flexibility=Flexibility.FIXED, fixed_at=span(10, 11))
        second = obj("f2", flexibility=Flexibility.FIXED, fixed_at=span(10, 11))
        suggestion = plan(WINDOW, [first, second])
        reasons = {item.object_id: item.reason for item in suggestion.skipped}
        self.assertEqual(list(reasons.values()), [Unplaceable.CONFLICTS_WITH_FIXED])

    def test_an_object_cannot_depend_on_itself(self):
        with self.assertRaises(PlanningRefused):
            obj("a", depends_on=("a",))

    def test_a_zero_length_object_is_refused(self):
        with self.assertRaises(PlanningRefused):
            obj("a", hours=0)


class DeterminismTests(unittest.TestCase):
    def population(self) -> list[ScheduleObject]:
        return [
            obj("a", hours=1, priority=Priority.HIGH),
            obj("b", hours=2, flexibility=Flexibility.PREFERRED, preferred_time=PreferredTime.MORNING),
            obj("c", hours=1, deadline=at(15)),
            obj("d", hours=0.5, priority=Priority.LOW),
            obj("e", hours=1.5),
            obj("f", hours=1, flexibility=Flexibility.FIXED, fixed_at=span(13, 14)),
        ]

    def test_the_same_inputs_in_any_order_produce_the_same_day(self):
        reference = plan(WINDOW, self.population())
        generator = random.Random(20260825)
        for attempt in range(25):
            shuffled = self.population()
            generator.shuffle(shuffled)
            with self.subTest(attempt=attempt):
                self.assertEqual(plan(WINDOW, shuffled), reference)

    def test_every_sort_key_ends_in_the_object_id(self):
        # Without this, anything that ties returns whatever order the input
        # happened to be in -- which is how a "deterministic" planner returns
        # two different days for the same day.
        for item in self.population():
            with self.subTest(object_id=item.object_id):
                self.assertEqual(item.sort_key()[-1], item.object_id)

    def test_two_objects_alike_in_everything_but_id_still_order_stably(self):
        twins = [obj("z"), obj("y")]
        self.assertEqual(plan(WINDOW, twins), plan(WINDOW, list(reversed(twins))))
        self.assertEqual(plan(WINDOW, twins).considered, ("y", "z"))

    def test_the_plan_records_what_it_considered(self):
        suggestion = plan(WINDOW, self.population())
        self.assertEqual(len(suggestion.considered), 6)
        self.assertEqual(sorted(suggestion.considered), list("abcdef"))

    def test_the_same_object_twice_is_refused(self):
        with self.assertRaises(PlanningRefused):
            plan(WINDOW, [obj("a"), obj("a")])


class SuggestionsOnlyTests(unittest.TestCase):
    FORBIDDEN = {"apply", "commit", "write", "save", "execute", "push", "sync"}

    def test_a_suggestion_has_no_method_that_applies_it(self):
        self.assertEqual({name for name in dir(Suggestion) if name in self.FORBIDDEN}, set())

    def test_nor_do_the_things_it_contains(self):
        from backend.planning.planner import Placement, Skipped

        for kind in (Placement, Skipped, stab.Move, stab.Replan, stab.ChangeCost):
            with self.subTest(kind=kind.__name__):
                self.assertEqual({name for name in dir(kind) if name in self.FORBIDDEN}, set())

    def test_the_planning_package_reaches_no_write_path(self):
        from pathlib import Path

        from backend.boundaries import imported_names

        root = Path(__file__).resolve().parents[1] / "backend" / "planning"
        for path in root.rglob("*.py"):
            for _, name in imported_names(path):
                with self.subTest(module=path.name, imported=name):
                    self.assertNotIn("write", name)
                    self.assertFalse(name.startswith("backend.gmail"))

    def test_the_declared_module_graph_still_holds(self):
        from backend.boundaries import all_errors
        from backend.modules import MODULES

        self.assertEqual(all_errors(), [])
        self.assertEqual(MODULES["planning"].depends_on, ("tasks", "calendar", "health"))


class RefusalsTests(unittest.TestCase):
    def test_a_blocked_object_is_reported_not_placed(self):
        # Its dependency is not in the plan at all.
        suggestion = plan(WINDOW, [obj("b", depends_on=("a",))])
        self.assertEqual(suggestion.placements, ())
        self.assertEqual(suggestion.skipped[0].reason, Unplaceable.BLOCKED)
        self.assertIn("waits on a", unplaceable_reasons(suggestion)["b"])

    def test_a_dependency_is_scheduled_before_its_dependent(self):
        suggestion = plan(WINDOW, [obj("a", hours=1), obj("b", hours=1, depends_on=("a",))])
        first = suggestion.placement_of("a").interval
        second = suggestion.placement_of("b").interval
        self.assertGreaterEqual(second.start, first.end)

    def test_an_object_that_cannot_fit_before_its_deadline_is_reported(self):
        suggestion = plan(
            WINDOW,
            [obj("big", hours=6), obj("late", hours=3, deadline=at(11))],
        )
        reasons = {item.object_id: item.reason for item in suggestion.skipped}
        self.assertEqual(reasons["late"], Unplaceable.PAST_DEADLINE)
        self.assertIn("earliest room is after", unplaceable_reasons(suggestion)["late"])

    def test_a_deadline_already_past_is_a_different_answer(self):
        suggestion = plan(WINDOW, [obj("a", deadline=at(8))])
        self.assertEqual(suggestion.skipped[0].reason, Unplaceable.DEADLINE_ALREADY_PASSED)

    def test_no_room_is_reported_rather_than_dropped(self):
        suggestion = plan(WINDOW, [obj("a", hours=8), obj("b", hours=2)])
        reasons = {item.object_id: item.reason for item in suggestion.skipped}
        self.assertEqual(reasons["b"], Unplaceable.NO_ROOM)

    def test_nothing_is_ever_silently_dropped(self):
        population = [obj("a", hours=5), obj("b", hours=5), obj("c", hours=5)]
        suggestion = plan(WINDOW, population)
        accounted = {item.object_id for item in suggestion.placements} | {
            item.object_id for item in suggestion.skipped
        }
        self.assertEqual(accounted, {"a", "b", "c"})

    def test_existing_commitments_occupy_the_window(self):
        suggestion = plan(WINDOW, [obj("a", hours=2)], commitments=[busy("m", 9, 12)])
        self.assertGreaterEqual(suggestion.placement_of("a").interval.start, at(12))

    def test_a_declined_commitment_does_not_occupy_anything(self):
        from backend.calendar.events import Response

        free = replace(busy("m", 9, 17), response=Response.DECLINED)
        suggestion = plan(WINDOW, [obj("a", hours=2)], commitments=[free])
        self.assertEqual(suggestion.placement_of("a").interval.start, at(9))


class PreferredTimeTests(unittest.TestCase):
    def test_a_preferred_object_gets_its_part_of_day_when_it_fits(self):
        morning = obj(
            "m", hours=1, flexibility=Flexibility.PREFERRED, preferred_time=PreferredTime.AFTERNOON
        )
        suggestion = plan(WINDOW, [morning])
        placement = suggestion.placement_of("m")
        self.assertTrue(placement.preference_met)
        self.assertGreaterEqual(placement.interval.start, at(12))

    def test_it_takes_another_time_rather_than_not_happening(self):
        afternoon = obj(
            "m", hours=1, flexibility=Flexibility.PREFERRED, preferred_time=PreferredTime.AFTERNOON
        )
        suggestion = plan(WINDOW, [afternoon], commitments=[busy("m", 12, 17)])
        placement = suggestion.placement_of("m")
        self.assertIsNotNone(placement)
        self.assertFalse(placement.preference_met)

    def test_the_parts_of_the_day_cover_it_without_overlapping(self):
        ranges = sorted(TIME_WINDOWS.values())
        for (_, first_end), (second_start, _) in zip(ranges, ranges[1:]):
            with self.subTest(boundary=(first_end, second_start)):
                self.assertEqual(first_end, second_start)
        self.assertEqual(ranges[-1][1], 24)

    def test_a_part_of_day_is_read_in_the_callers_zone_not_utc(self):
        evening = obj(
            "e", hours=1, flexibility=Flexibility.PREFERRED, preferred_time=PreferredTime.EVENING
        )
        wide = Interval(start=at(0), end=at(0, day=27))
        eastern = plan(wide, [evening], zone_offset=timedelta(hours=-4))
        utc = plan(wide, [evening], zone_offset=timedelta(0))
        self.assertNotEqual(
            eastern.placement_of("e").interval, utc.placement_of("e").interval
        )
        self.assertTrue(eastern.placement_of("e").preference_met)


class ChangeCostTests(unittest.TestCase):
    def test_a_fixed_object_has_no_price(self):
        fixed = obj("f", flexibility=Flexibility.FIXED, fixed_at=span(10, 11))
        with self.assertRaises(stab.MoveRefused):
            stab.change_cost(fixed, span(10, 11), span(12, 13))

    def test_not_moving_costs_nothing(self):
        self.assertEqual(stab.change_cost(obj("a"), span(10, 11), span(10, 11)).total, 0.0)

    def test_moving_a_preferred_object_costs_more_than_a_flexible_one(self):
        flexible = stab.change_cost(obj("a"), span(10, 11), span(11, 12))
        preferred = stab.change_cost(
            obj("a", flexibility=Flexibility.PREFERRED), span(10, 11), span(11, 12)
        )
        self.assertGreater(preferred.total, flexible.total)

    def test_moving_further_costs_more(self):
        near = stab.change_cost(obj("a"), span(10, 11), span(11, 12))
        far = stab.change_cost(obj("a"), span(10, 11), span(16, 17))
        self.assertGreater(far.total, near.total)

    def test_moving_a_longer_block_costs_more(self):
        short = stab.change_cost(
            obj("a", hours=1), span(10, 11), span(11, 12)
        )
        long = stab.change_cost(obj("a", hours=3), span(10, 13), span(11, 14))
        self.assertGreater(long.duration_cost, short.duration_cost)

    def test_crossing_a_day_costs_more_than_any_move_within_one(self):
        # "Tomorrow instead" is a different plan, not a nudge. Without this the
        # cost model would trade a large shove for a day change.
        worst_within_day = (
            max(stab.CLASS_COST.values())
            + stab.WITHIN_DAY_CAP
            + (24 * stab.PER_HOUR_OF_DURATION)
        )
        self.assertGreater(stab.DAY_BOUNDARY, stab.WITHIN_DAY_CAP + max(stab.CLASS_COST.values()))
        crossing = stab.change_cost(
            obj("a", flexibility=Flexibility.PREFERRED),
            span(16, 17),
            Interval(start=at(9, day=27), end=at(10, day=27)),
        )
        same_day = stab.change_cost(
            obj("a", flexibility=Flexibility.PREFERRED), span(9, 10), span(16, 17)
        )
        self.assertGreater(crossing.total, same_day.total)
        self.assertEqual(crossing.day_boundary_cost, stab.DAY_BOUNDARY)
        self.assertEqual(same_day.day_boundary_cost, 0.0)

    def test_the_day_boundary_is_read_in_the_callers_zone(self):
        # 23:00 and 01:00 UTC are the same local evening four hours west.
        crossing_in_utc = stab.change_cost(
            obj("a"),
            Interval(start=at(23), end=at(23, 30)),
            Interval(start=at(1, day=27), end=at(1, 30, day=27)),
            zone_offset=timedelta(hours=-4),
        )
        self.assertEqual(crossing_in_utc.day_boundary_cost, 0.0)

    def test_the_cost_names_its_parts(self):
        cost = stab.change_cost(
            obj("a", flexibility=Flexibility.PREFERRED), span(10, 11), span(14, 15)
        )
        self.assertEqual(cost.class_cost, stab.CLASS_COST[Flexibility.PREFERRED])
        self.assertGreater(cost.distance_cost, 0)
        self.assertEqual(
            cost.total,
            cost.class_cost + cost.distance_cost + cost.duration_cost + cost.day_boundary_cost,
        )


class NineInputsTests(unittest.TestCase):
    NAMED = (
        "deadline", "importance", "duration", "dependencies", "energy_requirement",
        "existing_commitments", "preferred_time", "previous_schedule", "change_cost",
    )

    def test_every_input_the_manifest_names_is_read_somewhere(self):
        self.assertEqual(set(stab.READS), set(self.NAMED))
        self.assertEqual(len(self.NAMED), 9)

    def test_importance_changes_the_score(self):
        placement = plan(WINDOW, [obj("a")]).placement_of("a")
        low = stab.score_placement(obj("a", priority=Priority.LOW), placement)
        critical = stab.score_placement(obj("a", priority=Priority.CRITICAL), placement)
        self.assertGreater(critical, low)

    def test_meeting_the_preference_is_worth_something(self):
        placement = plan(WINDOW, [obj("a")]).placement_of("a")
        met = stab.score_placement(obj("a"), replace(placement, preference_met=True))
        missed = stab.score_placement(obj("a"), replace(placement, preference_met=False))
        self.assertEqual(met - missed, stab.PREFERENCE_VALUE)

    def test_deadline_slack_is_worth_something_and_is_capped(self):
        placement = plan(WINDOW, [obj("a")]).placement_of("a")
        tight = stab.score_placement(obj("a", deadline=at(11)), placement)
        loose = stab.score_placement(obj("a", deadline=at(17)), placement)
        enormous = stab.score_placement(obj("a", deadline=at(17, day=30)), placement)
        self.assertGreater(loose, tight)
        self.assertEqual(loose + 0, loose)
        self.assertLessEqual(enormous - stab.PRIORITY_VALUE[Priority.NORMAL] - stab.ENERGY_FIT_VALUE - stab.PREFERENCE_VALUE, stab.SLACK_CAP)

    def test_energy_fit_is_read_from_the_callers_profile_not_assumed(self):
        placement = plan(WINDOW, [obj("a")]).placement_of("a")
        hard = obj("a", energy=Energy.HIGH)
        generous = {part: Energy.HIGH for part in PreferredTime}
        stingy = {part: Energy.LOW for part in PreferredTime}
        self.assertGreater(
            stab.score_placement(hard, placement, energy_profile=generous),
            stab.score_placement(hard, placement, energy_profile=stingy),
        )

    def test_there_is_no_default_energy_curve(self):
        # A planner that assumes mornings schedules a night owl's hardest work
        # at eight for the rest of their life.
        self.assertEqual(set(stab.flat_profile().values()), {Energy.MEDIUM})


class StabilityTests(unittest.TestCase):
    def full_day(self) -> list[ScheduleObject]:
        return [
            obj("a", hours=1, priority=Priority.HIGH),
            obj("b", hours=1, flexibility=Flexibility.PREFERRED),
            obj("c", hours=1),
            obj("d", hours=1),
            obj("e", hours=1),
        ]

    def test_adding_one_task_does_not_rearrange_the_day(self):
        population = self.full_day()
        before = plan(WINDOW, population)
        after = stab.replan(before, WINDOW, population + [obj("new", hours=1)])
        self.assertEqual(after.added, ("new",))
        self.assertEqual(after.moved, ())
        self.assertTrue(after.stable)
        self.assertEqual(set(after.kept), {"a", "b", "c", "d", "e"})

    def test_the_untouched_placements_are_the_same_objects(self):
        population = self.full_day()
        before = plan(WINDOW, population)
        after = stab.replan(before, WINDOW, population + [obj("new", hours=1)])
        for object_id in after.kept:
            with self.subTest(object_id=object_id):
                self.assertEqual(
                    after.suggestion.placement_of(object_id),
                    before.placement_of(object_id),
                )

    def test_a_move_that_does_not_beat_its_cost_is_declined_and_the_day_stands(self):
        # `a` is placed at 09:00. Nothing about the new plan is worth the class
        # cost plus the distance, so it does not move.
        one = obj("a", hours=1)
        before = plan(WINDOW, [one])
        move = stab.worth_moving(
            one,
            before.placement_of("a"),
            replace(before.placement_of("a"), interval=span(15, 16)),
        )
        self.assertFalse(move.worthwhile)
        self.assertLessEqual(move.improvement, move.cost.total)

    def test_a_move_that_beats_its_cost_is_taken(self):
        wanted = obj(
            "a", hours=1, flexibility=Flexibility.PREFERRED,
            preferred_time=PreferredTime.AFTERNOON, priority=Priority.CRITICAL,
        )
        was = plan(WINDOW, [wanted], commitments=[busy("m", 12, 17)]).placement_of("a")
        self.assertFalse(was.preference_met)
        becomes = replace(was, interval=span(13, 14), preference_met=True)
        move = stab.worth_moving(wanted, was, becomes)
        self.assertTrue(move.worthwhile)

    def test_a_move_that_exactly_breaks_even_does_not_happen(self):
        one = obj("a", hours=1)
        was = plan(WINDOW, [one]).placement_of("a")
        move = stab.Move(
            object_id="a",
            was=was.interval,
            becomes=span(10, 11),
            improvement=5.0,
            cost=stab.ChangeCost("a", 5.0, 0.0, 0.0, 0.0),
        )
        self.assertFalse(move.worthwhile)

    def test_a_placement_that_no_longer_fits_the_window_is_relocated_not_dropped(self):
        # Found by this test: a forced relocation was being put through the
        # cost comparison, so an object whose slot had vanished could be
        # "declined" out of the day entirely.
        one = obj("a", hours=1)
        before = plan(WINDOW, [one])
        narrower = span(12, 17)
        after = stab.replan(before, narrower, [one])
        self.assertNotIn("a", after.kept)
        self.assertEqual([move.object_id for move in after.relocated], ["a"])
        self.assertEqual(after.moved, ())
        self.assertTrue(after.stable)
        self.assertGreaterEqual(after.suggestion.placement_of("a").interval.start, at(12))

    def test_a_placement_a_new_commitment_now_covers_is_relocated(self):
        one = obj("a", hours=1)
        before = plan(WINDOW, [one])
        self.assertEqual(before.placement_of("a").interval, span(9, 10))
        after = stab.replan(before, WINDOW, [one], commitments=[busy("m", 9, 11)])
        self.assertNotIn("a", after.kept)
        self.assertEqual([move.object_id for move in after.relocated], ["a"])
        self.assertIsNotNone(after.suggestion.placement_of("a"))
        self.assertGreaterEqual(after.suggestion.placement_of("a").interval.start, at(11))

    def test_a_replan_reports_what_moved_and_what_it_bought(self):
        wanted = obj(
            "a", hours=1, flexibility=Flexibility.PREFERRED,
            preferred_time=PreferredTime.AFTERNOON, priority=Priority.CRITICAL,
        )
        before = plan(WINDOW, [wanted], commitments=[busy("m", 12, 17)])
        after = stab.replan(before, WINDOW, [wanted])
        self.assertEqual([move.object_id for move in after.moved], ["a"])
        self.assertGreater(after.moved[0].improvement, after.moved[0].cost.total)
        self.assertTrue(after.suggestion.placement_of("a").preference_met)

    def test_a_removed_object_leaves_the_others_alone(self):
        population = self.full_day()
        before = plan(WINDOW, population)
        after = stab.replan(before, WINDOW, [item for item in population if item.object_id != "c"])
        self.assertEqual(after.moved, ())
        self.assertNotIn("c", {item.object_id for item in after.suggestion.placements})

    def test_the_preferred_premium_applies_only_when_the_preference_was_met(self):
        # Otherwise PREFERRED collapses into FLEXIBLE: an object sitting at a
        # time the PLANNER chose as a fallback would be as expensive to move as
        # one the person deliberately put there, and it would never reach the
        # time it actually wanted.
        wanted = obj("a", hours=1, flexibility=Flexibility.PREFERRED)
        satisfied = stab.change_cost(
            wanted, span(9, 10), span(13, 14), previously_satisfied=True
        )
        compromise = stab.change_cost(
            wanted, span(9, 10), span(13, 14), previously_satisfied=False
        )
        self.assertEqual(satisfied.class_cost, stab.CLASS_COST[Flexibility.PREFERRED])
        self.assertEqual(compromise.class_cost, stab.CLASS_COST[Flexibility.FLEXIBLE])
        self.assertLess(compromise.total, satisfied.total)

    def test_worth_moving_reads_the_satisfaction_of_the_previous_placement(self):
        wanted = obj(
            "a", hours=1, flexibility=Flexibility.PREFERRED,
            preferred_time=PreferredTime.AFTERNOON,
        )
        was = plan(WINDOW, [wanted], commitments=[busy("m", 12, 17)]).placement_of("a")
        self.assertFalse(was.preference_met)
        move = stab.worth_moving(
            wanted, was, replace(was, interval=span(13, 14), preference_met=True)
        )
        self.assertEqual(move.cost.class_cost, stab.CLASS_COST[Flexibility.FLEXIBLE])

    def test_an_object_that_already_has_what_it_wanted_is_not_asked_again(self):
        # Asking anyway is how a stable planner becomes a churning one, finding
        # some fractional improvement worth a fractional cost on every pass.
        happy = obj(
            "a", hours=1, flexibility=Flexibility.PREFERRED,
            preferred_time=PreferredTime.MORNING,
        )
        before = plan(WINDOW, [happy])
        self.assertTrue(before.placement_of("a").preference_met)
        after = stab.replan(before, WINDOW, [happy])
        self.assertEqual(after.moved, ())
        self.assertEqual(after.declined, ())
        self.assertEqual(after.kept, ("a",))

    def test_a_relocation_is_not_counted_as_the_planner_rearranging_the_day(self):
        one = obj("a", hours=1)
        before = plan(WINDOW, [one])
        after = stab.replan(before, WINDOW, [one], commitments=[busy("m", 9, 11)])
        self.assertTrue(after.stable)
        self.assertNotEqual(after.relocated, ())

    def test_an_improvement_that_does_not_beat_its_cost_is_declined_and_recorded(self):
        # A real declined improvement: the evening slot the object actually
        # wants is free again, but it is eight hours away and the object is a
        # four-hour block. The preference is worth 12; moving costs 16.6.
        long_window = span(9, 21)
        wanted = obj(
            "a", hours=4, flexibility=Flexibility.PREFERRED,
            preferred_time=PreferredTime.EVENING,
        )
        before = plan(long_window, [wanted], commitments=[busy("m", 17, 21)])
        self.assertFalse(before.placement_of("a").preference_met)

        after = stab.replan(before, long_window, [wanted])
        self.assertEqual(after.moved, ())
        self.assertEqual([move.object_id for move in after.declined], ["a"])
        declined = after.declined[0]
        self.assertGreater(declined.improvement, 0)
        self.assertGreater(declined.cost.total, declined.improvement)
        # And the day is exactly the one the person already had.
        self.assertEqual(after.suggestion.placements, before.placements)

    def test_a_satisfied_object_is_not_offered_an_equally_good_alternative(self):
        # Earlier is not better. This object has its morning; asking it again
        # would find 09:00 free and produce a zero-improvement move for the
        # planner to decline every single pass.
        long_window = span(9, 21)
        happy = obj(
            "h", hours=1, flexibility=Flexibility.PREFERRED,
            preferred_time=PreferredTime.MORNING,
        )
        before = plan(long_window, [happy], commitments=[busy("m", 9, 10)])
        self.assertTrue(before.placement_of("h").preference_met)
        self.assertEqual(before.placement_of("h").interval, span(10, 11))

        after = stab.replan(before, long_window, [happy])
        self.assertEqual(after.kept, ("h",))
        self.assertEqual(after.moved, ())
        self.assertEqual(after.declined, ())
        self.assertEqual(after.suggestion.placement_of("h").interval, span(10, 11))

    def test_a_replan_of_an_unchanged_day_changes_nothing(self):
        population = self.full_day()
        before = plan(WINDOW, population)
        after = stab.replan(before, WINDOW, population)
        self.assertTrue(after.stable)
        self.assertEqual(after.added, ())
        self.assertEqual(after.suggestion.placements, before.placements)


class ReviewRegressionTests(unittest.TestCase):
    """Reproductions from the independent review of 2026-08-26.

    Each of these failed when it was written. Phases 23 and 24 were judged not
    complete as claimed on the strength of the first two.
    """

    def window(self) -> Interval:
        return Interval(start=at(8), end=at(20))

    def test_a_dependent_that_sorts_first_is_still_placed(self):
        # `sort_key` is not topological, so a dependent that sorted before its
        # dependency was reported BLOCKED with "waits on a_dep, which is not in
        # this plan" -- while a_dep was right there. 227 of 400 random
        # populations. The original test missed it because its two objects had
        # equal durations, so the id tiebreak ordered them correctly by luck.
        dependency = obj("a_dep", hours=0.5)
        dependent = obj("b_task", hours=2, depends_on=("a_dep",))
        suggestion = plan(self.window(), [dependency, dependent])
        self.assertEqual(suggestion.skipped, ())
        first = suggestion.placement_of("a_dep").interval
        second = suggestion.placement_of("b_task").interval
        self.assertGreaterEqual(second.start, first.end)

    def test_dependency_order_holds_however_the_input_is_ordered(self):
        population = [
            obj("z_first", hours=3),
            obj("m_middle", hours=1, depends_on=("z_first",)),
            obj("a_last", hours=0.5, depends_on=("m_middle",)),
        ]
        for ordering in (population, list(reversed(population))):
            with self.subTest():
                suggestion = plan(self.window(), ordering)
                self.assertEqual(suggestion.skipped, ())
                placed = {
                    item.object_id: item.interval for item in suggestion.placements
                }
                self.assertGreaterEqual(placed["m_middle"].start, placed["z_first"].end)
                self.assertGreaterEqual(placed["a_last"].start, placed["m_middle"].end)

    def test_a_genuinely_absent_dependency_is_still_blocked(self):
        suggestion = plan(self.window(), [obj("orphan", depends_on=("ghost",))])
        self.assertEqual(suggestion.skipped[0].reason, Unplaceable.BLOCKED)
        self.assertIn("ghost", suggestion.skipped[0].detail)

    def test_a_cycle_is_reported_as_a_cycle_not_as_an_absence(self):
        # Telling somebody their task "waits on c2, which is not in this plan"
        # when c2 is right there is the same false message, reached differently.
        cycle = [obj("c1", depends_on=("c2",)), obj("c2", depends_on=("c1",))]
        suggestion = plan(self.window(), cycle)
        self.assertEqual(len(suggestion.skipped), 2)
        for item in suggestion.skipped:
            with self.subTest(object_id=item.object_id):
                self.assertIn("cycle", item.detail)
                self.assertNotIn("not in this plan", item.detail)

    def test_replan_does_not_delete_a_task_after_one_small_meeting(self):
        # The exact failure "avoid reshuffling the user's day" exists to
        # prevent: the sub-plan could not see that a KEPT object satisfied a
        # dependency, so it reported the dependent BLOCKED and dropped it --
        # with eleven free hours in the window. 20 of 400 random populations.
        first = obj("a", hours=1)
        second = obj("b", hours=1, depends_on=("a",))
        before = plan(self.window(), [first, second])
        after = stab.replan(
            before, self.window(), [first, second], commitments=[busy("m1", 9, 10)]
        )
        placed = {item.object_id for item in after.suggestion.placements}
        self.assertEqual(placed, {"a", "b"})
        self.assertEqual(after.suggestion.skipped, ())

    def test_the_improvement_pass_cannot_move_a_dependent_before_its_dependency(self):
        # `best_placement` was called without `not_before`, so the only path
        # that can change a placement was free to break the hard constraint the
        # gate calls "a constraint, not a score".
        dependency = obj(
            "a", hours=1, flexibility=Flexibility.PREFERRED,
            preferred_time=PreferredTime.AFTERNOON,
        )
        dependent = obj(
            "b", hours=1, flexibility=Flexibility.PREFERRED,
            preferred_time=PreferredTime.MORNING, depends_on=("a",),
        )
        before = plan(self.window(), [dependency, dependent])
        after = stab.replan(before, self.window(), [dependency, dependent])
        placed = {item.object_id: item.interval for item in after.suggestion.placements}
        self.assertGreaterEqual(placed["b"].start, placed["a"].end)

    def test_a_rescheduled_fixed_object_does_not_crash_the_replan(self):
        # `worth_moving` on a FIXED object calls `change_cost`, which refuses --
        # correctly -- and took the whole replan down with it.
        old_time = Interval(start=at(10), end=at(11))
        new_time = Interval(start=at(14), end=at(15))
        was = obj("f", hours=1, flexibility=Flexibility.FIXED, fixed_at=old_time)
        now = obj("f", hours=1, flexibility=Flexibility.FIXED, fixed_at=new_time)
        after = stab.replan(
            plan(self.window(), [was]), self.window(), [now],
            commitments=[busy("m1", 10, 11)],
        )
        self.assertEqual(after.suggestion.placement_of("f").interval, new_time)
        self.assertEqual(after.refixed, ("f",))

    def test_a_rescheduled_fixed_object_is_not_kept_at_its_old_time(self):
        # `_still_valid` never compared the placement to `fixed_at`, so a moved
        # flight was reported as a stable, kept plan at the wrong hour.
        old_time = Interval(start=at(10), end=at(11))
        new_time = Interval(start=at(14), end=at(15))
        was = obj("f", hours=1, flexibility=Flexibility.FIXED, fixed_at=old_time)
        now = obj("f", hours=1, flexibility=Flexibility.FIXED, fixed_at=new_time)
        after = stab.replan(plan(self.window(), [was]), self.window(), [now])
        self.assertEqual(after.suggestion.placement_of("f").interval, new_time)
        self.assertNotIn("f", after.kept)
        self.assertEqual(after.refixed, ("f",))

    def test_the_improvement_pass_cannot_strand_a_dependent(self):
        # The other half of the dependency bound: moving something LATER pushes
        # it past the things that wait on it. The window is deliberately narrow
        # so the move is CHEAP -- an earlier version of this test put the
        # evening nine hours away, the cost check refused the move on price,
        # and the dependency guard was never reached at all.
        window = Interval(start=at(14), end=at(20))
        dependency = obj(
            "a", hours=1, flexibility=Flexibility.PREFERRED,
            preferred_time=PreferredTime.EVENING,
        )
        dependent = obj("b", hours=1, depends_on=("a",))
        before = plan(
            window, [dependency, dependent], commitments=[busy("m", 17, 20)]
        )
        self.assertFalse(before.placement_of("a").preference_met)
        self.assertEqual(before.placement_of("a").interval.start, at(14))
        self.assertEqual(before.placement_of("b").interval.start, at(15))

        # Without the guard the move pays for itself -- preference is worth 12,
        # the three-hour shift costs 6.1 -- so only the dependency stops it.
        candidate = replace(before.placement_of("a"), interval=span(17, 18), preference_met=True)
        priced = stab.worth_moving(dependency, before.placement_of("a"), candidate)
        self.assertTrue(priced.worthwhile)

        after = stab.replan(before, window, [dependency, dependent])
        placed = {item.object_id: item.interval for item in after.suggestion.placements}
        self.assertIn("a", placed)
        self.assertIn("b", placed)
        self.assertGreaterEqual(
            placed["b"].start, placed["a"].end,
            "the dependency was moved past the thing that waits on it",
        )

    def test_every_reads_entry_names_something_that_exists(self):
        # The test asserted the KEYS matched the manifest and never looked at
        # the values, so `deadline -> flat_profile` and two names that do not
        # exist all survived -- while `dependencies -> planner.plan` was the
        # entry the three findings above proved false.
        import backend.planning.planner as planner_module

        for manifest_input, target in stab.READS.items():
            with self.subTest(manifest_input=manifest_input):
                module, _, name = target.rpartition(".")
                holder = planner_module if module == "planner" else stab
                self.assertTrue(
                    callable(getattr(holder, name, None)),
                    f"{target} does not name a callable",
                )


if __name__ == "__main__":
    unittest.main()
