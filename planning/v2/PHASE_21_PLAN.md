# ORION v2 Phase 21 — Task System

Status: **planned — 2026-08-25**. Phase 20 closed the same day.

## What the manifest asks for

Fourteen fields of task metadata; estimated versus actual duration tracked; and
ORION allowed to improve its duration estimates over time.

## Where it lives

`backend/tasks/`. Phase 11 already declared `tasks`, `task_dependencies` and
`task_estimates`, and Phase 10 declared the module as owning
`("task", "task_dependency")` while depending on `users` alone. So this phase
fills a shape that already exists rather than inventing one, and the import
boundary check keeps it honest: `tasks` may not reach calendar, health or
planning, whatever a later convenience suggests.

## The three decisions worth stating

**Blocked is derived, never stored.** A task blocked by a dependency is blocked
because the dependency is open — the moment it closes, the block is gone. A
stored `blocked` status is a cached answer to a question that changes without
this module being told, so `status` has no such member and `is_blocked()` reads
the graph.

**A learned estimate is a prediction and cannot overwrite a measurement.** The
manifest asks ORION to improve its estimates, which means writing a number
derived from history into a field the user may have typed themselves. So
estimates are *records*, not a mutable field: each carries a `basis` saying
where it came from, the actual duration is written once when the task completes,
and nothing derived may claim `basis = MEASURED`. The one number that is
ground truth stays the one number nothing can synthesise.

**Too little history returns the estimate unchanged.** Learning from one finished
task produces a confident wrong number, and a confident wrong number is worse
than the original guess because it looks like it was earned. Below the sample
floor the learner declines and says so, the same shape as Phase 18's repetition
threshold.

## Flexibility is defined here and consumed by Phase 23

`flexibility` is one of the fourteen fields, and Phase 23 classifies schedule
objects as FIXED / PREFERRED / FLEXIBLE. Those are the same idea. Defining the
enum twice is how two modules end up disagreeing about whether a workout may
move, so it is defined once, here, and Phase 23 imports it.

## Exit criteria

- All fourteen manifest fields present, each with a checked type rather than a
  free-text blob.
- Dependency cycles refused, including self-dependency and indirect cycles.
- `blocked` is derived from the graph and is not a storable status.
- Actual duration exists only after completion; an open task's actual is `None`.
- A learned estimate records a non-measured basis, and cannot be recorded as
  measured.
- Below the sample floor, learning returns the prior estimate and reports that
  it declined.
- Python suite still green, and the new tests fail when each guard is removed.
