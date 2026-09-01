# ORION v2 Phase 23 — Planner v1

Status: **planned — 2026-08-25**. Phase 22 closed the same day.

## What the manifest asks for

A deterministic scheduling layer. Classify schedule objects FIXED / PREFERRED /
FLEXIBLE. **Produce suggestions only. Do not allow automatic schedule changes.**

## Deterministic means reproducible, and that has to be provable

"Deterministic" is easy to claim and easy to lose: one `set` iteration, one
`sorted()` without a tiebreak, one dictionary ordering assumption, and the same
inputs produce two different days. It is also the kind of defect that never
shows up in a test written once.

So the planner is tested by **running it twice on shuffled input** and asserting
the plans are identical, and every sort key ends in the task id. A plan also
carries the ordered inputs it was built from, so two plans that differ can be
told apart from two runs that differ.

## Suggestions only, enforced by the type

"Do not allow automatic schedule changes" implemented as "the planner does not
call the write API" lasts until somebody wires it to one. So the planner returns
`Suggestion` objects, and a `Suggestion` has **no method that applies it**.
Turning one into a change requires an approval path that Phase 25 owns and that
does not exist yet — so right now there is no code path from a plan to a
calendar, and that is checkable rather than promised.

## FIXED is not scheduled, it is respected

The three classes are not three priorities. A FIXED object is not something the
planner places well; it is something the planner is forbidden to move, and it
becomes an occupied interval before placement begins. PREFERRED objects want a
time and will accept another. FLEXIBLE objects only need to happen.

`Flexibility` is imported from `backend.tasks.attributes` rather than redeclared,
which Phase 21 recorded as its follow-up.

## What the planner refuses to do

- **Place a task that is blocked.** Phase 21 derives blocking from the graph;
  scheduling a task before its dependency is a plan that cannot be executed.
- **Place a task after its deadline.** It reports the task as unplaceable with
  the reason, rather than producing a plan that silently misses it.
- **Invent a duration.** A task with no estimate is not scheduled; the planner
  says it needs one. Assuming thirty minutes is how a plan becomes fiction.

## Exit criteria

- Three classes, imported not redeclared, with FIXED occupying rather than being
  placed.
- The same inputs in any order produce a byte-identical plan, asserted over a
  shuffled repeat.
- `Suggestion` has no apply/commit/write method; nothing in the package imports
  the calendar write path (which does not exist).
- Blocked, undated-estimate and past-deadline tasks are reported unplaceable
  with a reason, never silently dropped and never quietly placed.
