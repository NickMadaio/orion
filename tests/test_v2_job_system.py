"""Phase 8: the job system.

Eleven fields, twelve states, and eight mechanics. The tests that matter most are
the ones about time passing: an expired command must never execute after a device
reconnects, and a late answer from a lost attempt must never complete a job that
has moved on.
"""

from __future__ import annotations

import unittest
from datetime import datetime, timedelta, timezone

from orion.core.eventbus.bus import EventBus
from orion.core.eventbus.categories import Category
from orion.core.jobs.job import DEFAULT_MAX_ATTEMPTS, FIELDS, Job
from orion.core.jobs.queue import (
    DEFAULT_LEASE,
    IdempotencyConflict,
    JobExpired,
    JobQueue,
    StaleDelivery,
    UnknownJob,
    WrongDevice,
)
from orion.core.jobs.states import (
    PRE_EXECUTION,
    TERMINAL,
    TRANSITIONS,
    IllegalTransition,
    JobState,
    may_move,
)
from orion.security.decisions import PolicyDecision
from orion.security.vocabulary import RiskLevel
from orion.shared.result import DecisionOutcome


NOW = datetime(2026, 8, 24, 21, 0, tzinfo=timezone.utc)
TOKEN = "delivery-token-01"
TARGET = "mac-studio-0001"
LATER = NOW + timedelta(minutes=30)


def job(job_id="job-0001-aaaa", *, key="idem-0001", risk=RiskLevel.R4, ttl=timedelta(minutes=10), **overrides):
    fields = {
        "job_id": job_id,
        "user_id": "user-nick-0001",
        "origin_device": "iphone-nick-0001",
        "target_device": "mac-studio-0001",
        "capability": "file_delete",
        "arguments": {"path": "/Users/nick/Desktop/notes.txt"},
        "risk_level": risk,
        "created_at": NOW,
        "expires_at": NOW + ttl,
        "idempotency_key": key,
    }
    fields.update(overrides)
    return Job(**fields)


def decision(outcome=DecisionOutcome.ALLOW, risk=RiskLevel.R4, job_id="job-0001-aaaa"):
    return PolicyDecision(
        outcome=outcome,
        risk=risk,
        reason_codes=("all_gates_passed",),
        reasons=("fixture",),
        obligations=(),
        policy_version="policy-v2.5",
        request_id=job_id,
    )


def authorized(queue, *, now=NOW, outcome=DecisionOutcome.ALLOW):
    queue.submit(job(), now=now)
    queue.record_decision("job-0001-aaaa", decision(outcome), now=now)
    if outcome is DecisionOutcome.REQUIRE_APPROVAL:
        queue.approve("job-0001-aaaa", "approval-0001", now=now)
    return queue.enqueue("job-0001-aaaa", now=now)


class JobRecordTests(unittest.TestCase):
    def test_the_eleven_manifest_fields_are_present(self):
        self.assertEqual(
            FIELDS,
            {
                "job_id", "user_id", "origin_device", "target_device", "capability",
                "arguments", "risk_level", "created_at", "expires_at",
                "idempotency_key", "status",
            },
        )
        for field in FIELDS:
            self.assertIn(field, job().to_dict())

    def test_every_job_expires(self):
        with self.assertRaises(ValueError):
            job(ttl=timedelta(0))
        with self.assertRaises(ValueError):
            job(ttl=-timedelta(minutes=1))

    def test_a_transition_returns_a_new_job(self):
        original = job()
        moved = original.moved_to(JobState.POLICY_CHECKED)
        self.assertIs(original.status, JobState.CREATED)
        self.assertIs(moved.status, JobState.POLICY_CHECKED)

    def test_an_illegal_transition_is_refused_by_the_table(self):
        with self.assertRaises(IllegalTransition):
            job().moved_to(JobState.RUNNING)


class StateMachineTests(unittest.TestCase):
    def test_all_twelve_states_exist(self):
        self.assertEqual(len(JobState), 12)
        self.assertEqual(set(TRANSITIONS), set(JobState))

    def test_terminal_states_have_no_way_out(self):
        for state in TERMINAL:
            self.assertEqual(TRANSITIONS[state], frozenset(), state)

    def test_failed_is_not_terminal_because_a_retry_is_a_real_thing(self):
        self.assertNotIn(JobState.FAILED, TERMINAL)
        self.assertTrue(may_move(JobState.FAILED, JobState.QUEUED))

    def test_every_pre_execution_state_can_expire(self):
        # "Never allow an expired command to execute" needs an edge to EXPIRED
        # from every state a device could still be about to run from.
        for state in PRE_EXECUTION:
            self.assertTrue(may_move(state, JobState.EXPIRED), state)

    def test_every_non_terminal_state_can_be_cancelled(self):
        for state in JobState:
            if state in TERMINAL:
                continue
            self.assertTrue(may_move(state, JobState.CANCELLED), state)


class AuthorizationTests(unittest.TestCase):
    def setUp(self):
        self.queue = JobQueue()

    def test_the_three_policy_outcomes_reach_three_different_states(self):
        for outcome, expected in (
            (DecisionOutcome.ALLOW, JobState.AUTHORIZED),
            (DecisionOutcome.REQUIRE_APPROVAL, JobState.AWAITING_APPROVAL),
            (DecisionOutcome.DENY, JobState.REJECTED),
        ):
            queue = JobQueue()
            queue.submit(job(), now=NOW)
            self.assertIs(queue.record_decision("job-0001-aaaa", decision(outcome), now=NOW).status, expected)

    def test_a_decision_whose_risk_disagrees_with_the_job_is_rejected(self):
        self.queue.submit(job(risk=RiskLevel.R4), now=NOW)
        result = self.queue.record_decision(
            "job-0001-aaaa", decision(risk=RiskLevel.R1), now=NOW
        )
        self.assertIs(result.status, JobState.REJECTED)
        self.assertEqual(result.reason, "risk_mismatch")

    def test_approval_is_recorded_on_the_job(self):
        self.queue.submit(job(), now=NOW)
        self.queue.record_decision("job-0001-aaaa", decision(DecisionOutcome.REQUIRE_APPROVAL), now=NOW)
        approved = self.queue.approve("job-0001-aaaa", "approval-0001", now=NOW)
        self.assertEqual(str(approved.approval_reference), "approval-0001")

    def test_only_a_policy_decision_moves_a_job_on(self):
        self.queue.submit(job(), now=NOW)
        with self.assertRaises(ValueError):
            self.queue.record_decision("job-0001-aaaa", {"outcome": "ALLOW"}, now=NOW)


class IdempotencyTests(unittest.TestCase):
    def test_the_same_key_returns_the_same_job(self):
        queue = JobQueue()
        first = queue.submit(job("job-0001-aaaa", key="idem-0001"), now=NOW)
        second = queue.submit(job("job-0002-aaaa", key="idem-0001"), now=NOW)
        self.assertEqual(first.job_id, second.job_id)
        self.assertEqual(len(queue), 1)

    def test_a_different_key_makes_a_different_job(self):
        queue = JobQueue()
        queue.submit(job("job-0001-aaaa", key="idem-0001"), now=NOW)
        queue.submit(job("job-0002-aaaa", key="idem-0002"), now=NOW)
        self.assertEqual(len(queue), 2)

    def test_the_key_is_scoped_to_the_user(self):
        queue = JobQueue()
        queue.submit(job("job-0001-aaaa", key="idem-0001"), now=NOW)
        queue.submit(job("job-0002-aaaa", key="idem-0001", user_id="user-other-0001"), now=NOW)
        self.assertEqual(len(queue), 2)

    def test_a_resubmission_after_completion_does_not_run_again(self):
        queue = JobQueue()
        authorized(queue)
        queue.dispatch("job-0001-aaaa", token=TOKEN, now=NOW)
        queue.start("job-0001-aaaa", TOKEN, device=TARGET, now=NOW)
        queue.succeed("job-0001-aaaa", TOKEN, device=TARGET, now=NOW)
        again = queue.submit(job("job-0009-aaaa", key="idem-0001"), now=NOW)
        self.assertIs(again.status, JobState.SUCCEEDED)
        self.assertEqual(len(queue), 1)

    def test_a_job_cannot_be_submitted_already_expired(self):
        queue = JobQueue()
        with self.assertRaises(ValueError):
            queue.submit(job(), now=LATER)


class ExpiryTests(unittest.TestCase):
    """The manifest's one absolute, checked at each moment time can pass."""

    def setUp(self):
        self.queue = JobQueue()

    def test_a_device_that_reconnects_after_the_ttl_cannot_start(self):
        authorized(self.queue)
        self.queue.dispatch("job-0001-aaaa", token=TOKEN, now=NOW)
        with self.assertRaises(JobExpired):
            self.queue.start("job-0001-aaaa", TOKEN, device=TARGET, now=LATER)
        self.assertIs(self.queue.get("job-0001-aaaa").status, JobState.EXPIRED)

    def test_the_exact_instant_of_expiry_is_already_expired(self):
        authorized(self.queue)
        deadline = NOW + timedelta(minutes=10)
        self.queue.dispatch("job-0001-aaaa", token=TOKEN, now=deadline - timedelta(microseconds=1))
        with self.assertRaises(JobExpired):
            self.queue.start("job-0001-aaaa", TOKEN, device=TARGET, now=deadline)

    def test_an_expired_job_cannot_be_dispatched(self):
        authorized(self.queue)
        with self.assertRaises(JobExpired):
            self.queue.dispatch("job-0001-aaaa", token=TOKEN, now=LATER)

    def test_an_expired_job_cannot_be_delivered(self):
        authorized(self.queue)
        self.queue.dispatch("job-0001-aaaa", token=TOKEN, now=NOW)
        with self.assertRaises(JobExpired):
            self.queue.deliver("job-0001-aaaa", TOKEN, now=LATER)

    def test_an_expired_job_cannot_be_authorized_or_queued_either(self):
        self.queue.submit(job(), now=NOW)
        with self.assertRaises(JobExpired):
            self.queue.record_decision("job-0001-aaaa", decision(), now=LATER)

    def test_work_that_started_in_time_may_still_report_what_it_did(self):
        # Refusing a late success would leave a half-done delete with no record
        # that it happened, which is worse than a late success.
        authorized(self.queue)
        self.queue.dispatch("job-0001-aaaa", token=TOKEN, now=NOW)
        self.queue.start("job-0001-aaaa", TOKEN, device=TARGET, now=NOW)
        self.assertIs(self.queue.succeed("job-0001-aaaa", TOKEN, device=TARGET, now=LATER).status, JobState.SUCCEEDED)

    def test_a_sweep_expires_what_is_out_of_time(self):
        authorized(self.queue)
        changed = self.queue.sweep(LATER)
        self.assertEqual([item.status for item in changed], [JobState.EXPIRED])

    def test_a_sweep_touches_nothing_that_is_still_live(self):
        authorized(self.queue)
        self.assertEqual(self.queue.sweep(NOW + timedelta(seconds=1)), ())


class DeliveryTests(unittest.TestCase):
    def setUp(self):
        self.queue = JobQueue()
        authorized(self.queue)
        self.queue.dispatch("job-0001-aaaa", token=TOKEN, now=NOW)

    def test_duplicate_delivery_is_a_no_op(self):
        first = self.queue.deliver("job-0001-aaaa", TOKEN, now=NOW)
        second = self.queue.deliver("job-0001-aaaa", TOKEN, now=NOW)
        self.assertEqual(first, second)
        self.assertIs(self.queue.get("job-0001-aaaa").status, JobState.DISPATCHED)

    def test_a_stale_token_cannot_start_complete_or_fail(self):
        for method, arguments in (
            (self.queue.start, {"device": TARGET}),
            (self.queue.succeed, {"device": TARGET}),
            (self.queue.fail, {"device": TARGET, "reason": "whatever"}),
        ):
            with self.assertRaises(StaleDelivery):
                method("job-0001-aaaa", "delivery-token-99", now=NOW, **arguments)

    def test_a_redispatch_invalidates_the_previous_token(self):
        self.queue.fail("job-0001-aaaa", TOKEN, device=TARGET, reason="device error", now=NOW)
        self.queue.dispatch("job-0001-aaaa", token="delivery-token-02", now=NOW)
        with self.assertRaises(StaleDelivery):
            self.queue.start("job-0001-aaaa", TOKEN, device=TARGET, now=NOW)
        self.assertIs(
            self.queue.start("job-0001-aaaa", "delivery-token-02", device=TARGET, now=NOW).status,
            JobState.RUNNING
        )

    def test_dispatch_counts_an_attempt(self):
        self.assertEqual(self.queue.get("job-0001-aaaa").attempts, 1)

    def test_an_unknown_job_is_an_error_not_a_silent_miss(self):
        with self.assertRaises(UnknownJob):
            self.queue.get("job-9999-zzzz")


class LostAcknowledgementTests(unittest.TestCase):
    def setUp(self):
        self.queue = JobQueue(lease=timedelta(minutes=2))
        authorized(self.queue)
        self.queue.dispatch("job-0001-aaaa", token=TOKEN, now=NOW)

    def test_an_unanswered_dispatch_goes_back_to_the_queue(self):
        changed = self.queue.sweep(NOW + DEFAULT_LEASE + timedelta(seconds=1))
        self.assertEqual([item.status for item in changed], [JobState.QUEUED])
        self.assertIsNone(self.queue.get("job-0001-aaaa").delivery_token)

    def test_the_late_answer_from_the_lost_attempt_cannot_land(self):
        self.queue.sweep(NOW + DEFAULT_LEASE + timedelta(seconds=1))
        with self.assertRaises(StaleDelivery):
            self.queue.succeed("job-0001-aaaa", TOKEN, device=TARGET, now=NOW + timedelta(minutes=3))

    def test_a_job_that_had_started_is_recorded_as_failed_before_being_retried(self):
        # It did start. An audit trail that hides that cannot explain a duplicate
        # side effect later.
        self.queue.start("job-0001-aaaa", TOKEN, device=TARGET, now=NOW)
        self.queue.sweep(NOW + DEFAULT_LEASE + timedelta(seconds=1))
        self.assertEqual(self.queue.get("job-0001-aaaa").reason, "acknowledgement_lost")

    def test_retries_stop_at_the_limit(self):
        for attempt in range(DEFAULT_MAX_ATTEMPTS + 2):
            current = self.queue.get("job-0001-aaaa")
            if current.status is JobState.QUEUED:
                self.queue.dispatch("job-0001-aaaa", token=f"delivery-token-{attempt:02d}", now=NOW)
            self.queue.sweep(NOW + DEFAULT_LEASE + timedelta(seconds=1))
        final = self.queue.get("job-0001-aaaa")
        self.assertIs(final.status, JobState.EXPIRED)
        self.assertLessEqual(final.attempts, DEFAULT_MAX_ATTEMPTS)


class CancellationTests(unittest.TestCase):
    def test_a_device_cannot_run_a_job_targeted_at_another_device(self):
        queue = JobQueue()
        authorized(queue)
        queue.dispatch("job-0001-aaaa", token=TOKEN, now=NOW)
        with self.assertRaises(WrongDevice):
            queue.start("job-0001-aaaa", TOKEN, device="iphone-nick-0001", now=NOW)

    def test_only_the_target_device_may_report_an_outcome(self):
        # A token is a secret and a device identity is a claim; every path a
        # device can move a job needs both, not just start().
        queue = JobQueue()
        authorized(queue)
        queue.dispatch("job-0001-aaaa", token=TOKEN, now=NOW)
        queue.start("job-0001-aaaa", TOKEN, device=TARGET, now=NOW)
        with self.assertRaises(WrongDevice):
            queue.succeed("job-0001-aaaa", TOKEN, device="iphone-nick-0001", now=NOW)
        with self.assertRaises(WrongDevice):
            queue.fail("job-0001-aaaa", TOKEN, device="iphone-nick-0001", reason="lie", now=NOW)

    def test_a_reused_key_for_a_different_job_is_a_conflict(self):
        queue = JobQueue()
        queue.submit(job(), now=NOW)
        with self.assertRaises(IdempotencyConflict):
            queue.submit(job("job-0002-aaaa", capability="file_move"), now=NOW)

    def test_events_are_stamped_when_the_change_happened(self):
        seen: list[str] = []
        bus = EventBus()
        bus.subscribe("clock", lambda event: seen.append(event.occurred_at.isoformat()),
                      categories=[Category.REMOTE_JOBS])
        queue = JobQueue(bus=bus)
        queue.submit(job(), now=NOW)
        queue.record_decision("job-0001-aaaa", decision(), now=NOW + timedelta(minutes=1))
        queue.enqueue("job-0001-aaaa", now=NOW + timedelta(minutes=2))
        self.assertEqual(len(set(seen)), 3, seen)

    def test_a_dispatched_job_can_still_be_cancelled(self):
        queue = JobQueue()
        authorized(queue)
        queue.dispatch("job-0001-aaaa", token=TOKEN, now=NOW)
        cancelled = queue.cancel("job-0001-aaaa", now=NOW)
        self.assertIs(cancelled.status, JobState.CANCELLED)
        # The device may still hold it, which is why start re-checks rather than
        # trusting what the device was told at dispatch.
        with self.assertRaises(RuntimeError):
            queue.start("job-0001-aaaa", TOKEN, device=TARGET, now=NOW)

    def test_cancelling_clears_the_delivery_token(self):
        # Otherwise a device still holding the token could answer a cancelled job.
        queue = JobQueue()
        authorized(queue)
        queue.dispatch("job-0001-aaaa", token=TOKEN, now=NOW)
        self.assertIsNone(queue.cancel("job-0001-aaaa", now=NOW).delivery_token)

    def test_cancelling_a_finished_job_changes_nothing(self):
        queue = JobQueue()
        authorized(queue)
        queue.dispatch("job-0001-aaaa", token=TOKEN, now=NOW)
        queue.start("job-0001-aaaa", TOKEN, device=TARGET, now=NOW)
        queue.succeed("job-0001-aaaa", TOKEN, device=TARGET, now=NOW)
        self.assertIs(queue.cancel("job-0001-aaaa", now=NOW).status, JobState.SUCCEEDED)


class EventTests(unittest.TestCase):
    def setUp(self):
        self.seen: list[tuple[str, object]] = []
        self.bus = EventBus()
        self.bus.subscribe(
            "watcher",
            lambda event: self.seen.append((event.event_type, event.payload.get("status"))),
            categories=[Category.REMOTE_JOBS],
        )
        self.queue = JobQueue(bus=self.bus)

    def test_every_state_change_is_announced(self):
        authorized(self.queue)
        self.queue.dispatch("job-0001-aaaa", token=TOKEN, now=NOW)
        self.assertEqual(self.seen[0][0], "remote_jobs.job_created")
        self.assertEqual(
            [status for _, status in self.seen[1:]],
            ["POLICY_CHECKED", "AUTHORIZED", "QUEUED", "DISPATCHED"],
        )

    def test_a_jobs_arguments_never_reach_the_bus(self):
        authorized(self.queue)
        payloads = []
        self.bus.subscribe(
            "payload_watcher", lambda event: payloads.append(dict(event.payload)),
            categories=[Category.REMOTE_JOBS],
        )
        self.queue.dispatch("job-0001-aaaa", token=TOKEN, now=NOW)
        for payload in payloads:
            self.assertNotIn("arguments", payload)
            self.assertNotIn("path", payload)

    def test_a_queue_without_a_bus_still_works(self):
        queue = JobQueue()
        self.assertIs(authorized(queue).status, JobState.QUEUED)


if __name__ == "__main__":
    unittest.main()
