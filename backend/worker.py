"""The background worker, and the thing Phase 8 said needed an owner.

Phase 8 ended with a follow-up: `JobQueue.sweep(now)` has no caller, because
Core owns no runloop by design, and a lease nobody sweeps is a lease that never
expires. This declares the loop that owns it.

Declared rather than run: there is no process here. What is decidable now is
which periodic work exists, how often it runs, and that each piece names the
module responsible -- so the first implementation wires a table rather than
inventing a schedule.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable

from backend.modules import MODULES


@dataclass(frozen=True, slots=True)
class PeriodicTask:
    name: str
    module: str
    every_seconds: int
    purpose: str
    #: Whether skipping a run is safe. A sweep that is late expires a lease late;
    #: a delivery that is skipped is a notification nobody gets.
    skippable: bool

    def __post_init__(self) -> None:
        if self.every_seconds < 1:
            raise ValueError(f"{self.name}: an interval must be positive")
        if self.module not in MODULES:
            raise ValueError(f"{self.name}: unknown module {self.module}")
        if not self.purpose.endswith("."):
            raise ValueError(f"{self.name}: purpose must be a sentence")


PERIODIC: tuple[PeriodicTask, ...] = (
    PeriodicTask(
        "sweep_jobs", "jobs", 30,
        "Expire jobs past their TTL and requeue those whose acknowledgement was lost.",
        skippable=False,
    ),
    PeriodicTask(
        "deliver_notifications", "notifications", 15,
        "Send raised notifications through their channel.",
        skippable=False,
    ),
    PeriodicTask(
        "sync_connectors", "connectors", 300,
        "Pull changes from connected third parties.",
        skippable=True,
    ),
    PeriodicTask(
        "run_automations", "automations", 60,
        "Start automations whose trigger has fired.",
        skippable=True,
    ),
)


def worker_errors(tasks: Iterable[PeriodicTask] | None = None) -> list[str]:
    table = PERIODIC if tasks is None else tuple(tasks)
    errors: list[str] = []
    names = [task.name for task in table]
    if len(set(names)) != len(names):
        errors.append("a periodic task is declared twice")
    if not any(task.name == "sweep_jobs" for task in table):
        # Named explicitly: this is the Phase 8 follow-up, and a worker table
        # that quietly loses it takes the job system's expiry rules with it.
        errors.append("nothing sweeps the job queue; Phase 8's leases would never expire")
    return errors
