# ORION v2 Phase 24 — Schedule Stability

Status: **planned — 2026-08-25**. Phase 23 closed the same day.

## What the manifest asks for

A cost for moving already-planned items. Favour stability over constant
theoretical optimization. Consider deadline, importance, duration, dependencies,
energy requirement, existing commitments, preferred time, previous schedule, and
change cost. **Avoid reshuffling the whole day after a small change.**

## The failure this exists to prevent

A planner that re-optimises from scratch produces a *better* day every time and a
*different* day every time. The person, who has already decided to run at six,
sees their morning rearranged because a task acquired a deadline. They stop
trusting the plan, which costs more than the optimisation gained.

So stability is not a tiebreak applied at the end. Moving an already-placed item
carries a **cost that the improvement must beat**, and the comparison is made
explicit: a replan records what it moved and what the move bought.

## Change cost is not one number

Moving something has different costs depending on what it is. Reordering two
flexible errands is nearly free; moving a preferred workout the person
deliberately put at six is not; moving a fixed commitment is not permitted at
all. And moving something *by five minutes* is not the same as moving it to next
Tuesday.

So the cost has three parts — what kind of thing moved, how far, and whether it
crossed a day boundary — and the last one is deliberately steep, because
"tomorrow instead" is a different plan, not a nudge.

## The rule that keeps a small change small

A replan is scoped to what actually changed. An item whose placement is still
valid — nothing it depends on moved, its window is still free — is **kept
without being reconsidered**. That is what stops one new task from touching
everything: the planner is not choosing to leave the rest alone, it is never
asked about the rest.

## Exit criteria

- All nine named inputs are read by the cost or the placement, each traceable to
  a line.
- Moving a FIXED item is refused outright.
- A replan after adding one task moves a bounded number of items, asserted
  against a full day, and the untouched ones are the same objects.
- A move only happens when the improvement beats the cost, with a test where an
  improvement that does not beat it is declined and the day stays as it was.
- Crossing a day boundary costs more than any within-day move.
- A replan reports what moved and why, so the person can be told.
