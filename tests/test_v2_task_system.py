"""Phase 21: the task system.

Three rules carry this phase, and each has tests that fail when the guard is
removed rather than tests that merely exercise the happy path:

- blocked is derived from the graph, so it cannot go stale;
- a learned estimate can never be recorded as a measurement;
- too little history declines rather than guessing.
"""

from __future__ import annotations

import unittest
from dataclasses import FrozenInstanceError, replace
from datetime import datetime, timedelta, timezone

from backend.tasks import dependencies as deps
from backend.tasks import estimates as est
from backend.tasks.attributes import (
    RANK,
    Energy,
    Flexibility,
    Interruptibility,
    Physical,
    PreferredTime,
    Priority,
    Status,
    TERMINAL,
    rank_of,
)
from backend.tasks.task import MAX_ESTIMATE_MINUTES, Task, TaskRefused


NINE = datetime(2026, 8, 25, 9, 0, tzinfo=timezone.utc)


def task(task_id: str = "t1", **kwargs) -> Task:
    fields = {"id": task_id, "user_id": "u1", "title": "Write the thing"}
    fields.update(kwargs)
    return Task(**fields)


class ManifestFieldsTests(unittest.TestCase):
    """All fourteen named fields exist, and each is typed."""

    FIELDS = (
        "title", "description", "deadline", "estimated_duration", "priority",
        "energy_requirement", "physical_requirement", "interruptibility",
        "location", "required_device", "dependencies", "flexibility",
        "preferred_time", "status",
    )

    def test_every_manifest_field_is_present(self):
        for field in self.FIELDS:
            with self.subTest(field=field):
                self.assertTrue(hasattr(task(), field))

    def test_there_are_fourteen_of_them(self):
        self.assertEqual(len(self.FIELDS), 14)
        self.assertEqual(len(set(self.FIELDS)), 14)

    def test_vocabularies_reject_a_string_that_is_not_a_member(self):
        for field, bad in (
            ("priority", "urgent"),
            ("energy_requirement", "hi"),
            ("physical_requirement", "hard"),
            ("interruptibility", "sometimes"),
            ("flexibility", "movable"),
            ("preferred_time", "lunchtime"),
            ("status", "blocked"),
        ):
            with self.subTest(field=field):
                with self.assertRaises(ValueError):
                    task(**{field: bad})

    def test_blocked_is_not_a_status(self):
        # The whole point: it is derived, so it cannot be stored stale.
        self.assertNotIn("blocked", {member.value for member in Status})

    def test_a_task_is_immutable(self):
        with self.assertRaises(FrozenInstanceError):
            task().title = "something else"

    def test_ordered_vocabularies_compare(self):
        self.assertLess(rank_of(Priority.LOW), rank_of(Priority.CRITICAL))
        self.assertLess(rank_of(Flexibility.FLEXIBLE), rank_of(Flexibility.FIXED))
        self.assertLess(rank_of(Physical.NONE), rank_of(Physical.STRENUOUS))
        for vocabulary, order in RANK.items():
            with self.subTest(vocabulary=vocabulary.__name__):
                self.assertEqual(len(order), len(list(vocabulary)))

    def test_an_unordered_vocabulary_has_no_rank(self):
        with self.assertRaises(TypeError):
            rank_of(PreferredTime.MORNING)


class FieldRulesTests(unittest.TestCase):
    def test_a_naive_deadline_is_refused(self):
        with self.assertRaises(TaskRefused):
            task(deadline=datetime(2026, 8, 26, 9, 0))

    def test_a_deadline_is_normalised_to_utc(self):
        eastern = timezone(timedelta(hours=-4))
        built = task(deadline=datetime(2026, 8, 26, 5, 0, tzinfo=eastern))
        self.assertEqual(built.deadline, datetime(2026, 8, 26, 9, 0, tzinfo=timezone.utc))

    def test_no_estimate_is_a_real_state_and_zero_is_not(self):
        self.assertIsNone(task().estimated_duration)
        with self.assertRaises(TaskRefused):
            task(estimated_duration=0)

    def test_an_estimate_beyond_the_ceiling_is_a_project(self):
        with self.assertRaises(TaskRefused):
            task(estimated_duration=MAX_ESTIMATE_MINUTES + 1)

    def test_a_boolean_is_not_a_number_of_minutes(self):
        with self.assertRaises(TaskRefused):
            task(estimated_duration=True)

    def test_blank_optional_text_is_refused_rather_than_stored(self):
        for field in ("location", "required_device"):
            with self.subTest(field=field):
                with self.assertRaises(TaskRefused):
                    task(**{field: "   "})

    def test_a_title_is_required(self):
        with self.assertRaises(TaskRefused):
            task(title="   ")

    def test_a_task_cannot_depend_on_itself(self):
        with self.assertRaises(TaskRefused):
            task("a", dependencies=("a",))

    def test_a_duplicated_dependency_is_refused(self):
        with self.assertRaises(TaskRefused):
            task("a", dependencies=("b", "b"))


class MeasurementTests(unittest.TestCase):
    """actual_duration is measured, never supplied."""

    def test_a_caller_cannot_hand_in_an_actual_duration(self):
        with self.assertRaises(TaskRefused):
            task(actual_duration=45)

    def test_a_supplied_actual_must_match_the_measured_span(self):
        started = task().start(NINE)
        with self.assertRaises(TaskRefused):
            replace(
                started,
                status=Status.DONE,
                completed_at=NINE + timedelta(minutes=30),
                actual_duration=5,
            )

    def test_completing_measures_the_span(self):
        done = task(estimated_duration=30).start(NINE).complete(NINE + timedelta(minutes=45))
        self.assertEqual(done.actual_duration, 45)
        self.assertEqual(done.overran(), 15)
        self.assertIs(done.status, Status.DONE)

    def test_a_task_completed_without_being_started_has_no_actual(self):
        done = task().complete(NINE)
        self.assertIsNone(done.actual_duration)
        self.assertIsNone(done.overran())

    def test_a_task_cannot_finish_before_it_started(self):
        started = task().start(NINE)
        with self.assertRaises(TaskRefused):
            started.complete(NINE - timedelta(minutes=1))

    def test_a_sub_minute_task_measures_as_one_minute_not_zero(self):
        done = task().start(NINE).complete(NINE + timedelta(seconds=20))
        self.assertEqual(done.actual_duration, 1)

    def test_a_finished_task_cannot_be_finished_again(self):
        done = task().start(NINE).complete(NINE + timedelta(minutes=10))
        for closing in (lambda: done.complete(NINE), lambda: done.drop(NINE)):
            with self.subTest():
                with self.assertRaises(TaskRefused):
                    closing()

    def test_a_dropped_task_records_when(self):
        dropped = task().drop(NINE)
        self.assertIs(dropped.status, Status.DROPPED)
        self.assertEqual(dropped.completed_at, NINE)
        self.assertIsNone(dropped.actual_duration)

    def test_terminal_states_are_the_two_that_record_completion(self):
        self.assertEqual(TERMINAL, {Status.DONE, Status.DROPPED})

    def test_an_unfinished_task_may_not_carry_a_completion_time(self):
        with self.assertRaises(TaskRefused):
            task(status=Status.OPEN, completed_at=NINE)

    def test_re_estimating_a_finished_task_is_refused(self):
        done = task(estimated_duration=30).start(NINE).complete(NINE + timedelta(minutes=45))
        with self.assertRaises(TaskRefused):
            done.with_estimate(60)

    def test_re_estimating_an_open_task_leaves_the_measurement_alone(self):
        open_task = task(estimated_duration=30)
        self.assertEqual(open_task.with_estimate(60).estimated_duration, 60)
        self.assertIsNone(open_task.with_estimate(60).actual_duration)


class DependencyGraphTests(unittest.TestCase):
    def test_a_direct_cycle_is_refused(self):
        a = task("a", dependencies=("b",))
        b = task("b", dependencies=("a",))
        with self.assertRaises(deps.DependencyRefused):
            deps.check([a, b])

    def test_an_indirect_cycle_is_refused(self):
        a = task("a", dependencies=("b",))
        b = task("b", dependencies=("c",))
        c = task("c", dependencies=("a",))
        with self.assertRaises(deps.DependencyRefused) as caught:
            deps.check([a, b, c])
        self.assertIn("cycle", str(caught.exception))

    def test_a_long_chain_does_not_blow_the_stack(self):
        chain = [task("t0")]
        for index in range(1, 3000):
            chain.append(task(f"t{index}", dependencies=(f"t{index - 1}",)))
        self.assertIsNone(deps.find_cycle({item.id: item for item in chain}))

    def test_a_diamond_is_not_a_cycle(self):
        graph = [
            task("a"),
            task("b", dependencies=("a",)),
            task("c", dependencies=("a",)),
            task("d", dependencies=("b", "c")),
        ]
        self.assertEqual(len(deps.check(graph)), 4)

    def test_adding_an_edge_that_would_cycle_is_refused_before_it_is_added(self):
        a = task("a")
        b = task("b", dependencies=("a",))
        with self.assertRaises(deps.DependencyRefused):
            deps.add_dependency([a, b], "a", "b")

    def test_adding_a_safe_edge_returns_a_new_graph(self):
        a, b = task("a"), task("b")
        updated = {item.id: item for item in deps.add_dependency([a, b], "b", "a")}
        self.assertEqual(updated["b"].dependencies, ("a",))
        self.assertEqual(b.dependencies, ())

    def test_adding_an_edge_twice_changes_nothing(self):
        a, b = task("a"), task("b")
        once = deps.add_dependency([a, b], "b", "a")
        twice = deps.add_dependency(once, "b", "a")
        self.assertEqual({item.id: item.dependencies for item in twice}["b"], ("a",))

    def test_a_dependency_may_not_cross_an_owner(self):
        mine = task("a")
        theirs = Task(id="b", user_id="u2", title="Theirs")
        with self.assertRaises(deps.DependencyRefused):
            deps.check([replace(mine, dependencies=("b",)), theirs])
        with self.assertRaises(deps.DependencyRefused):
            deps.add_dependency([mine, theirs], "a", "b")

    def test_a_missing_dependency_is_refused_by_the_whole_graph_check(self):
        with self.assertRaises(deps.DependencyRefused):
            deps.check([task("a", dependencies=("ghost",))])

    def test_the_same_task_twice_is_refused(self):
        with self.assertRaises(deps.DependencyRefused):
            deps.check([task("a"), task("a")])


class BlockingIsDerivedTests(unittest.TestCase):
    def test_an_open_dependency_blocks(self):
        a = task("a")
        b = task("b", dependencies=("a",))
        by_id = deps.check([a, b])
        self.assertTrue(deps.is_blocked(b, by_id))
        self.assertEqual(deps.blockers(b, by_id), ("a",))

    def test_completing_the_dependency_unblocks_without_touching_the_dependent(self):
        a = task("a")
        b = task("b", dependencies=("a",))
        after = deps.check([a.start(NINE).complete(NINE + timedelta(minutes=5)), b])
        # `b` is the identical object -- nothing wrote a status onto it.
        self.assertFalse(deps.is_blocked(b, after))
        self.assertIs(b.status, Status.OPEN)

    def test_a_dropped_dependency_does_not_block_forever(self):
        a = task("a").drop(NINE)
        b = task("b", dependencies=("a",))
        self.assertFalse(deps.is_blocked(b, deps.check([a, b])))

    def test_an_in_progress_dependency_still_blocks(self):
        a = task("a").start(NINE)
        b = task("b", dependencies=("a",))
        self.assertTrue(deps.is_blocked(b, deps.check([a, b])))

    def test_an_unknown_dependency_blocks_rather_than_counting_as_satisfied(self):
        b = task("b", dependencies=("ghost",))
        self.assertTrue(deps.is_blocked(b, {"b": b}))
        self.assertEqual(deps.blockers(b, {"b": b}), ("ghost",))

    def test_ready_is_open_and_unblocked_only(self):
        a = task("a")
        b = task("b", dependencies=("a",))
        c = task("c").start(NINE)
        self.assertEqual([item.id for item in deps.ready([a, b, c])], ["a"])


class EstimateBasisTests(unittest.TestCase):
    """A prediction can never be recorded as a measurement."""

    def test_measured_without_a_completion_is_refused(self):
        with self.assertRaises(est.EstimateRefused):
            est.Estimate(task_id="a", minutes=30, basis=est.Basis.MEASURED)

    def test_a_prediction_may_not_cite_a_measurement(self):
        for basis in est.PREDICTED:
            with self.subTest(basis=basis):
                with self.assertRaises(est.EstimateRefused):
                    est.Estimate(task_id="a", minutes=30, basis=basis, measured_from=NINE)

    def test_record_measurement_is_the_only_producer_of_a_measurement(self):
        done = task(estimated_duration=30).start(NINE).complete(NINE + timedelta(minutes=45))
        recorded = est.record_measurement(done)
        self.assertIs(recorded.basis, est.Basis.MEASURED)
        self.assertTrue(recorded.is_measurement)
        self.assertEqual(recorded.minutes, 45)
        self.assertEqual(recorded.measured_from, done.completed_at)

    def test_a_task_that_never_ran_has_no_measurement_to_record(self):
        with self.assertRaises(est.EstimateRefused):
            est.record_measurement(task().complete(NINE))

    def test_an_open_task_has_no_measurement_to_record(self):
        with self.assertRaises(est.EstimateRefused):
            est.record_measurement(task(estimated_duration=30))

    def test_predicted_bases_are_the_three_that_are_not_measurements(self):
        self.assertEqual(
            est.PREDICTED,
            {est.Basis.USER, est.Basis.LEARNED, est.Basis.DEFAULT},
        )
        self.assertNotIn(est.Basis.MEASURED, est.PREDICTED)


def finished(task_id: str, estimated: int, actual: int, **kwargs) -> Task:
    started = task(task_id, estimated_duration=estimated, **kwargs).start(NINE)
    return started.complete(NINE + timedelta(minutes=actual))


class LearningTests(unittest.TestCase):
    def test_below_the_floor_it_declines_rather_than_guessing(self):
        history = est.observations([finished("a", 30, 60), finished("b", 30, 60)])
        learning = est.learn(("medium", "none"), history)
        self.assertFalse(learning.learned)
        self.assertEqual(learning.factor, 1.0)
        self.assertEqual(learning.samples, 2)
        self.assertIn("3 are needed", learning.declined)

    def test_the_floor_is_three(self):
        self.assertEqual(est.SAMPLE_FLOOR, 3)

    def test_at_the_floor_it_learns(self):
        history = est.observations(
            [finished("a", 30, 60), finished("b", 30, 60), finished("c", 30, 60)]
        )
        learning = est.learn(("medium", "none"), history)
        self.assertTrue(learning.learned)
        self.assertEqual(learning.factor, 2.0)
        self.assertIsNone(learning.declined)

    def test_one_disaster_does_not_move_the_median(self):
        history = est.observations(
            [
                finished("a", 30, 30),
                finished("b", 30, 30),
                finished("c", 30, 30),
                finished("d", 30, 480),
            ]
        )
        self.assertEqual(est.learn(("medium", "none"), history).factor, 1.0)

    def test_an_extreme_but_consistent_history_is_clamped_and_says_so(self):
        history = est.observations([finished(f"t{i}", 10, 480) for i in range(3)])
        learning = est.learn(("medium", "none"), history)
        self.assertTrue(learning.clamped)
        self.assertEqual(learning.factor, est.MAX_FACTOR)

    def test_buckets_do_not_leak_into_each_other(self):
        desk = [finished(f"d{i}", 30, 60) for i in range(3)]
        gym = [
            finished(f"g{i}", 30, 30, physical_requirement=Physical.STRENUOUS)
            for i in range(3)
        ]
        history = est.observations(desk + gym)
        self.assertEqual(est.learn(("medium", "none"), history).factor, 2.0)
        self.assertEqual(est.learn(("medium", "strenuous"), history).factor, 1.0)

    def test_a_task_with_no_estimate_teaches_nothing_and_gets_nothing(self):
        history = est.observations([finished(f"t{i}", 30, 60) for i in range(3)])
        self.assertEqual(len(history), 3)
        estimate, learning = est.improve(task("n"), history)
        self.assertIsNone(estimate)
        self.assertIn("no estimate to correct", learning.declined)

    def test_unfinished_and_unestimated_tasks_are_skipped_not_defaulted(self):
        history = est.observations(
            [task("open", estimated_duration=30), task("noest").start(NINE).complete(NINE)]
        )
        self.assertEqual(history, ())

    def test_improve_produces_a_learned_estimate_never_a_measured_one(self):
        history = est.observations([finished(f"t{i}", 30, 60) for i in range(3)])
        estimate, learning = est.improve(task("n", estimated_duration=30), history)
        self.assertIsNotNone(estimate)
        self.assertIs(estimate.basis, est.Basis.LEARNED)
        self.assertFalse(estimate.is_measurement)
        self.assertIsNone(estimate.measured_from)
        self.assertEqual(estimate.minutes, 60)
        self.assertEqual(learning.samples, 3)

    def test_improve_declines_when_history_agrees(self):
        history = est.observations([finished(f"t{i}", 30, 30) for i in range(3)])
        estimate, learning = est.improve(task("n", estimated_duration=30), history)
        self.assertIsNone(estimate)
        self.assertIn("agrees", learning.declined)

    def test_improve_declines_below_the_floor_and_returns_the_reason(self):
        history = est.observations([finished("a", 30, 60)])
        estimate, learning = est.improve(task("n", estimated_duration=30), history)
        self.assertIsNone(estimate)
        self.assertFalse(learning.learned)

    def test_a_learned_estimate_never_exceeds_the_task_ceiling(self):
        history = est.observations([finished(f"t{i}", 300, 900) for i in range(3)])
        estimate, _ = est.improve(task("n", estimated_duration=200), history)
        self.assertEqual(estimate.minutes, MAX_ESTIMATE_MINUTES)

    def test_the_floor_stopping_a_correction_is_not_blamed_on_the_ceiling(self):
        # A THIRD case produces the same number. The shared `max(1, min(...))`
        # folded the one-minute floor into the ceiling's message, so a task
        # history says should take a FIFTH as long was told the ceiling had
        # stopped it -- the opposite of what history said. Found by review.
        history = est.observations([finished(f"t{i}", 100, 20) for i in range(3)])
        estimate, learning = est.improve(task("n", estimated_duration=1), history)
        self.assertIsNone(estimate)
        self.assertIn("floor", learning.declined)
        self.assertNotIn("ceiling", learning.declined)
        self.assertLess(learning.factor, 1.0)

    def test_the_ceiling_stopping_a_correction_is_not_reported_as_agreement(self):
        # Found by this test: both cases produce the same number, and calling
        # the second one "agreement" tells the person their estimate was
        # confirmed when history in fact said three times longer.
        history = est.observations([finished(f"t{i}", 300, 900) for i in range(3)])
        estimate, learning = est.improve(task("n", estimated_duration=MAX_ESTIMATE_MINUTES), history)
        self.assertIsNone(estimate)
        self.assertIn("ceiling", learning.declined)
        self.assertNotIn("agrees", learning.declined)
        self.assertEqual(learning.factor, est.MAX_FACTOR)

    def test_applying_a_learned_estimate_leaves_the_task_measurement_free(self):
        history = est.observations([finished(f"t{i}", 30, 60) for i in range(3)])
        target = task("n", estimated_duration=30)
        estimate, _ = est.improve(target, history)
        updated = target.with_estimate(estimate.minutes)
        self.assertEqual(updated.estimated_duration, 60)
        self.assertIsNone(updated.actual_duration)


class ModuleBoundaryTests(unittest.TestCase):
    def test_tasks_declares_what_it_owns_and_reaches_no_further(self):
        from backend.modules import MODULES

        self.assertEqual(MODULES["tasks"].depends_on, ("users",))

    def test_flexibility_is_defined_once_for_phase_23_to_import(self):
        self.assertEqual(
            {member.value for member in Flexibility},
            {"fixed", "preferred", "flexible"},
        )


if __name__ == "__main__":
    unittest.main()
