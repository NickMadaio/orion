# ORION v2 Phase 27 — ORION Action Inbox

Status: **planned — 2026-08-26**. Phase 26 closed the same day.

## What the manifest asks for

An assistant-focused inbox rather than another email client. Nine
classifications. Surface actionable items on Today. Allow classifications to be
corrected, and use corrections as preference signals — **but do not
automatically turn correction history into unrestricted model memory.**

## The line that rule is drawing

"I corrected this newsletter to low_priority four times" is a fact about how a
person wants their inbox sorted. It is *not* a licence for ORION to conclude
"Nick doesn't care about marketing email" and carry that into an unrelated
conversation. The first is a preference bound to a scope; the second is a
durable claim about a person, derived by inference from external content — and
Phases 3 and 18 already refuse exactly that.

So a correction produces a `PreferenceSignal` that:

- is **scoped** — it applies to inbox classification and nothing else;
- has a provenance of `ORION_INFERRED` when it is aggregated, which Phase 18's
  `NEVER_DURABLE` already refuses to promote;
- has **no method that yields memory**, and no field a sentence could live in.

The test calls Phase 18's own checker on it, so the refusal is inherited rather
than restated.

## Nine classifications, and one that is not a failure

The manifest lists nine. As with Phase 20's capture kinds, the honest addition is
that a classifier must be able to decline: a classifier that always answers
produces a wrong answer for anything unusual. `unclassified` is therefore a
tenth member that is a real state, and only the manifest's nine may be
*surfaced* on Today.

## Actionable is a property of the classification, not a second opinion

Which classes reach Today is a table, checked, rather than a rule each caller
re-derives. `needs_reply` and `waiting_on` are actionable; `newsletter` and
`receipt` are not. A classification with no entry in that table is refused,
because a class added later would otherwise silently default one way.

## Still no mirror

A `ClassifiedItem` carries a message id and a classification, and no text — the
same field walk as Phase 26. Phase 26's recorded follow-up said this explicitly.

## Exit criteria

- The manifest's nine, plus `unclassified` as a declinable state.
- Every class has an actionability entry; a class without one is refused.
- Corrections are recorded and produce scoped preference signals.
- A preference signal cannot become durable memory — proven with Phase 18's
  checker, over aggregated signals of every class.
- `ClassifiedItem` has no free-text field, asserted by walking its fields.
- Correction history is bounded and per-class, not an open log of a person.
