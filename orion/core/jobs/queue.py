"""The job queue: idempotency, dispatch, leases, retries, cancellation, expiry.

Core owns no clock and no randomness. Every method takes `now`, and a dispatch
takes the delivery token it should mint. Both are arguments for the same reason:
a queue whose behaviour depends on ambient state cannot be tested without
sleeping, and a job system that is hard to test is a job system whose expiry
rules are believed rather than known.

The manifest's absolute -- "never allow an expired command to execute after a
device reconnects" -- is enforced at every method, not once at dispatch. The
whole difficulty is that time passes between dispatch and execution.
"""

from __future__ import annotations

import hmac
from dataclasses import replace
from datetime import datetime, timedelta, timezone
from typing import Iterable, Mapping

from orion.core.eventbus.bus import EventBus
from orion.core.eventbus.envelope import EventEnvelope
from orion.core.jobs.job import Job
from orion.core.jobs.states import PRE_EXECUTION, JobState
from orion.security.decisions import PolicyDecision
from orion.shared.identifiers import Identifier
from orion.shared.result import DecisionOutcome, Sensitivity


#: How long a device has to answer before the queue assumes the answer is lost.
DEFAULT_LEASE = timedelta(minutes=2)


class UnknownJob(KeyError):
    """No job by that id."""


class JobExpired(RuntimeError):
    """The job's TTL passed before it could be acted on.

    Raised rather than returned, because every caller of these methods is about
    to do something with the job, and a return value is easy to not look at.
    The job has already been moved to EXPIRED by the time this is raised.
    """

    def __init__(self, job: Job) -> None:
        super().__init__(f"job {job.job_id} expired at {job.expires_at.isoformat()}")
        self.job = job


class WrongDevice(RuntimeError):
    """A device answered for a job that targets a different device."""


class IdempotencyConflict(ValueError):
    """The same key was reused for a materially different job."""


class StaleDelivery(RuntimeError):
    """An answer arrived carrying a delivery token that is no longer current.

    This is the replay guard. It fires on a genuine replay, and equally on the
    honest case it exists for: a device that was slow, was redispatched, and then
    answered for the first attempt.
    """


class JobQueue:
    def __init__(
        self,
        *,
        bus: EventBus | None = None,
        lease: timedelta = DEFAULT_LEASE,
        source: str = "orion.jobs",
    ) -> None:
        self._jobs: dict[str, Job] = {}
        self._by_idempotency: dict[tuple[str, str], str] = {}
        self._bus = bus
        self._lease = lease
        self._source = source
        self._sequence = 0

    # -- reading -----------------------------------------------------------

    def get(self, job_id: str) -> Job:
        try:
            return self._jobs[str(job_id)]
        except KeyError:
            raise UnknownJob(f"unknown job: {job_id}") from None

    def __len__(self) -> int:
        return len(self._jobs)

    def in_state(self, state: JobState) -> tuple[Job, ...]:
        return tuple(job for job in self._jobs.values() if job.status is state)

    # -- submission --------------------------------------------------------

    def submit(self, job: Job, *, now: datetime) -> Job:
        """Register a job, or return the one this key already made.

        Idempotency is about the SUBMITTER: retrying a request that may already
        have landed must not create a second job. It is a different problem from
        replay prevention, which is about the device, and conflating them is how
        one of the two ends up unimplemented.
        """

        if not isinstance(job, Job):
            raise ValueError("submit takes a Job")
        key = (str(job.user_id), job.idempotency_key)
        existing = self._by_idempotency.get(key)
        if existing is not None:
            previous = self._jobs[existing]
            if (
                previous.capability != job.capability
                or previous.arguments != job.arguments
                or previous.target_device != job.target_device
            ):
                # Returning the old job for a DIFFERENT request under the same
                # key is how a caller silently gets work it did not ask for.
                raise IdempotencyConflict(
                    f"idempotency key {job.idempotency_key} was used for a different job"
                )
            return previous
        if str(job.job_id) in self._jobs:
            raise ValueError(f"job {job.job_id} already exists")
        if job.is_expired_at(now):
            raise ValueError("a job cannot be submitted already expired")
        self._jobs[str(job.job_id)] = job
        self._by_idempotency[key] = str(job.job_id)
        self._publish(
            "remote_jobs.job_created", job, {"job_id": str(job.job_id)}, occurred_at=now
        )
        return job

    # -- authorization -----------------------------------------------------

    def record_decision(self, job_id: str, decision: PolicyDecision, *, now: datetime) -> Job:
        """Move a job on with the Phase 5 engine's answer.

        The three outcomes map onto three of the manifest's states, which is why
        the state list has all three: a job is not simply allowed or not.
        """

        job = self._fresh(job_id, now)
        if not isinstance(decision, PolicyDecision):
            raise ValueError("record_decision takes a PolicyDecision")
        # Stored before branching, so the audit stream shows the check happening
        # rather than a job jumping straight from CREATED to REJECTED.
        checked = self._store(
            job.moved_to(JobState.POLICY_CHECKED, reason=", ".join(decision.reason_codes)), now
        )
        if decision.risk is not job.risk_level:
            # The job says R1 and the engine says R4. Refusing rather than
            # trusting either is the rule Phase 5 applies to declared risk.
            return self._store(checked.moved_to(JobState.REJECTED, reason="risk_mismatch"), now)
        if decision.outcome is DecisionOutcome.DENY:
            return self._store(checked.moved_to(JobState.REJECTED), now)
        if decision.outcome is DecisionOutcome.REQUIRE_APPROVAL:
            return self._store(checked.moved_to(JobState.AWAITING_APPROVAL), now)
        return self._store(checked.moved_to(JobState.AUTHORIZED), now)

    def approve(self, job_id: str, approval_reference: str, *, now: datetime) -> Job:
        job = self._fresh(job_id, now)
        return self._store(
            job.moved_to(JobState.AUTHORIZED, approval_reference=Identifier(approval_reference)), now
        )

    def enqueue(self, job_id: str, *, now: datetime) -> Job:
        job = self._fresh(job_id, now)
        return self._store(job.moved_to(JobState.QUEUED), now)

    # -- delivery ----------------------------------------------------------

    def dispatch(self, job_id: str, *, token: str, now: datetime) -> Job:
        """Hand a job to its device, minting the token that answer must carry.

        A redispatch mints a NEW token, which is what makes a lost
        acknowledgement recoverable: the late answer from the previous attempt
        can no longer complete the job.
        """

        job = self._fresh(job_id, now)
        return self._store(
            job.moved_to(
                JobState.DISPATCHED,
                delivery_token=Identifier(token),
                lease_expires_at=_aware(now, "now") + self._lease,
                attempts=job.attempts + 1,
            ),
            now,
        )

    def deliver(self, job_id: str, token: str, *, now: datetime) -> Job:
        """A device confirming receipt. Idempotent by construction.

        Duplicate delivery is the normal case on a flaky link, so this changes no
        state: it validates that the job is still live and that the token is the
        current one, and says yes as many times as it is asked.
        """

        job = self._fresh(job_id, now)
        self._require_token(job, token)
        return job

    def start(self, job_id: str, token: str, *, device: str, now: datetime) -> Job:
        """The reconnection check, and the wrong-device check.

        A device that went dark holding an authorized job and came back an hour
        later arrives here. `_fresh` has already expired it, so this raises
        rather than running -- which is the manifest's one absolute.

        `device` is required rather than optional. Writing Phase 9's invariant
        suite found that this method authenticated the delivery TOKEN and never
        asked which device was answering: a token that leaked would have let any
        device run a job targeted at another. A token is a secret; a device
        identity is a claim; the invariant "wrong devices cannot execute targeted
        jobs" needs both checked.
        """

        job = self._fresh(job_id, now)
        self._require_token(job, token)
        self._require_device(job, device)
        return self._store(job.moved_to(JobState.RUNNING), now)

    def succeed(self, job_id: str, token: str, *, device: str, now: datetime) -> Job:
        job = self.get(job_id)
        self._require_token(job, token)
        self._require_device(job, device)
        # Deliberately no expiry check: work that legitimately started before the
        # TTL is allowed to report what it did. Refusing the result would leave a
        # half-done delete with no record that it happened, which is worse than a
        # late success.
        return self._store(job.moved_to(JobState.SUCCEEDED, lease_expires_at=None), now)

    def fail(self, job_id: str, token: str, *, device: str, reason: str, now: datetime) -> Job:
        job = self.get(job_id)
        self._require_token(job, token)
        self._require_device(job, device)
        failed = self._store(
            job.moved_to(JobState.FAILED, reason=reason, lease_expires_at=None), now
        )
        return self._retry_or_finish(failed, now)

    def cancel(self, job_id: str, *, now: datetime, reason: str = "cancelled") -> Job:
        """Cancel from any non-terminal state.

        The device may already hold the job; that is why `start` re-checks state
        rather than trusting whatever the device was told when it was dispatched.
        """

        job = self.get(job_id)
        if job.terminal:
            return job
        return self._store(job.moved_to(JobState.CANCELLED, reason=reason, delivery_token=None), now)

    # -- housekeeping ------------------------------------------------------

    def sweep(self, now: datetime) -> tuple[Job, ...]:
        """Expire what is out of time, requeue what lost its acknowledgement.

        Called by whatever owns a runloop. Returns everything it changed, so the
        caller can report rather than discover.
        """

        moment = _aware(now, "now")
        changed: list[Job] = []
        for job in list(self._jobs.values()):
            if job.terminal:
                continue
            if job.is_expired_at(moment) and job.status in PRE_EXECUTION | {JobState.FAILED}:
                changed.append(
                    self._store(job.moved_to(JobState.EXPIRED, reason="ttl_elapsed"), moment)
                )
                continue
            if job.status in {JobState.DISPATCHED, JobState.RUNNING} and job.lease_lost_at(moment):
                lost = job
                if lost.status is JobState.RUNNING:
                    # Recorded as a failure rather than silently requeued: it did
                    # start, and an audit trail that hides that cannot explain a
                    # duplicate side effect later.
                    lost = self._store(
                        lost.moved_to(JobState.FAILED, reason="acknowledgement_lost"), moment
                    )
                else:
                    lost = self._store(
                        lost.moved_to(JobState.FAILED, reason="delivery_unacknowledged"), moment
                    )
                changed.append(self._retry_or_finish(lost, moment))
        return tuple(changed)

    # -- internals ---------------------------------------------------------

    def _retry_or_finish(self, job: Job, now: datetime) -> Job:
        # A job out of attempts ends in EXPIRED rather than FAILED, because the
        # manifest's twelve states have no "exhausted" and FAILED is the state a
        # retry comes back from -- leaving it there would mean a job that is
        # finished but never terminal. The reason field carries which of the two
        # ran out, so an audit reader is not left guessing.
        out_of_time = job.is_expired_at(now)
        if out_of_time or not job.retriable():
            cause = "ttl_elapsed" if out_of_time else "no attempts left"
            reason = f"{job.reason}; {cause}" if job.reason else cause
            return self._store(job.moved_to(JobState.EXPIRED, reason=reason), now)
        # The old token dies here. A late answer from the failed attempt cannot
        # complete the requeued job.
        return self._store(
            job.moved_to(JobState.QUEUED, delivery_token=None, lease_expires_at=None), now
        )

    def _fresh(self, job_id: str, now: datetime) -> Job:
        job = self.get(job_id)
        moment = _aware(now, "now")
        if job.status is JobState.EXPIRED:
            raise JobExpired(job)
        if job.terminal:
            raise _terminal(job)
        if job.is_expired_at(moment):
            raise JobExpired(self._store(job.moved_to(JobState.EXPIRED, reason="ttl_elapsed"), moment))
        return job

    def _require_token(self, job: Job, token: str) -> None:
        # Constant-time: the token is a secret, and a comparison that returns
        # early leaks how much of it a caller guessed right.
        if job.delivery_token is None or not hmac.compare_digest(str(job.delivery_token), str(token)):
            raise StaleDelivery(
                f"job {job.job_id} was not dispatched with that delivery token"
            )

    def _require_device(self, job: Job, device: str) -> None:
        """Every answer path asks this, not just `start`.

        A token is a secret and a device identity is a claim; the invariant
        "wrong devices cannot execute targeted jobs" needs both, on every path a
        device can move a job -- including the ones that only report an outcome,
        because a false success is as damaging as a false start.
        """

        if str(device) != str(job.target_device):
            raise WrongDevice(f"job {job.job_id} targets {job.target_device}, not {device}")

    def _store(self, job: Job, now: datetime) -> Job:
        previous = self._jobs.get(str(job.job_id))
        self._jobs[str(job.job_id)] = job
        if previous is None or previous.status is not job.status:
            self._publish(
                "remote_jobs.job_state_changed",
                job,
                {"job_id": str(job.job_id), "status": job.status.value},
                occurred_at=now,
            )
        return job

    def _publish(
        self,
        event_type: str,
        job: Job,
        payload: Mapping[str, object],
        *,
        occurred_at: datetime,
    ) -> None:
        """Announce a state change on the Phase 7 bus.

        The payload carries ids and statuses and never `arguments`: a job's
        arguments are the user's data, and the bus is not the place for them.
        """

        if self._bus is None:
            return
        self._sequence += 1
        self._bus.publish(
            EventEnvelope(
                event_id=f"{job.job_id}.e{self._sequence:04d}",
                event_type=event_type,
                version=1,
                user_id=job.user_id,
                source=self._source,
                # When the change happened, not when the job was created. Every
                # event carrying the creation time makes any ordering or latency
                # reading of the stream wrong.
                occurred_at=_aware(occurred_at, "occurred_at"),
                sensitivity=Sensitivity.INTERNAL,
                correlation_id=job.job_id,
                payload=dict(payload),
            )
        )


def _terminal(job: Job) -> RuntimeError:
    return RuntimeError(f"job {job.job_id} is already {job.status.value}")


def _aware(value: object, name: str) -> datetime:
    if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
        raise ValueError(f"{name} must be a timezone-aware datetime")
    return value.astimezone(timezone.utc)
