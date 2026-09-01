"""The twelve job states, and the only legal moves between them.

A transition table rather than conditionals spread through the queue. Scattered
`if job.status == ...` checks are how a state machine acquires an illegal edge
nobody notices: each individual check looks reasonable, and no single place
describes the machine.
"""

from __future__ import annotations

from enum import Enum
from types import MappingProxyType
from typing import Mapping


class JobState(str, Enum):
    CREATED = "CREATED"
    POLICY_CHECKED = "POLICY_CHECKED"
    AWAITING_APPROVAL = "AWAITING_APPROVAL"
    AUTHORIZED = "AUTHORIZED"
    QUEUED = "QUEUED"
    DISPATCHED = "DISPATCHED"
    RUNNING = "RUNNING"
    SUCCEEDED = "SUCCEEDED"
    FAILED = "FAILED"
    CANCELLED = "CANCELLED"
    EXPIRED = "EXPIRED"
    REJECTED = "REJECTED"


#: Nothing leaves these. A terminal job that could move again is a job that can
#: run twice.
TERMINAL = frozenset(
    {
        JobState.SUCCEEDED,
        JobState.CANCELLED,
        JobState.EXPIRED,
        JobState.REJECTED,
    }
)

#: FAILED is deliberately not terminal: a failed attempt may be retried while the
#: job still has attempts and time. It becomes terminal by running out of one of
#: those, which is a different state (EXPIRED) or a caller's decision.
TRANSITIONS: Mapping[JobState, frozenset[JobState]] = MappingProxyType(
    {
        JobState.CREATED: frozenset({JobState.POLICY_CHECKED, JobState.CANCELLED, JobState.EXPIRED}),
        JobState.POLICY_CHECKED: frozenset(
            {JobState.AUTHORIZED, JobState.AWAITING_APPROVAL, JobState.REJECTED,
             JobState.CANCELLED, JobState.EXPIRED}
        ),
        JobState.AWAITING_APPROVAL: frozenset(
            {JobState.AUTHORIZED, JobState.REJECTED, JobState.CANCELLED, JobState.EXPIRED}
        ),
        JobState.AUTHORIZED: frozenset({JobState.QUEUED, JobState.CANCELLED, JobState.EXPIRED}),
        JobState.QUEUED: frozenset({JobState.DISPATCHED, JobState.CANCELLED, JobState.EXPIRED}),
        JobState.DISPATCHED: frozenset(
            {JobState.RUNNING, JobState.QUEUED, JobState.FAILED, JobState.CANCELLED, JobState.EXPIRED}
        ),
        JobState.RUNNING: frozenset(
            {JobState.SUCCEEDED, JobState.FAILED, JobState.CANCELLED, JobState.EXPIRED}
        ),
        JobState.FAILED: frozenset({JobState.QUEUED, JobState.EXPIRED, JobState.CANCELLED}),
        JobState.SUCCEEDED: frozenset(),
        JobState.CANCELLED: frozenset(),
        JobState.EXPIRED: frozenset(),
        JobState.REJECTED: frozenset(),
    }
)

#: States in which a device could still be about to run the work. Expiry has to
#: bite in every one of them, because "the device reconnected holding the job" is
#: the case the manifest calls out by name.
PRE_EXECUTION = frozenset(
    {
        JobState.CREATED,
        JobState.POLICY_CHECKED,
        JobState.AWAITING_APPROVAL,
        JobState.AUTHORIZED,
        JobState.QUEUED,
        JobState.DISPATCHED,
    }
)


class IllegalTransition(ValueError):
    """A move the machine does not have an edge for."""


def may_move(current: JobState, target: JobState) -> bool:
    return target in TRANSITIONS[current]


def require_move(current: JobState, target: JobState) -> None:
    if not may_move(current, target):
        raise IllegalTransition(f"a job cannot go from {current.value} to {target.value}")


def is_terminal(state: JobState) -> bool:
    return state in TERMINAL
