# ORION v2 Phase 32 — ORION Health State

Status: **planned — 2026-08-26**. Phase 31 closed the same day.

## What the manifest asks for

Derived states: `sleep_state`, `physical_recovery`, `physical_load`,
`energy_state`, `stress_trend`, `data_confidence`. **Prefer categories and ranges
over meaningless decimal scores.** Always preserve `reason`, `baseline`,
`confidence`, `freshness`. **Do not represent these states as diagnoses.**

## Four fields that must survive, so they are not optional

"Always preserve reason, baseline, confidence and freshness" implemented as four
optional fields is four fields that are `nil` the first time somebody is in a
hurry. They are required, non-empty, and a state cannot be constructed without
them — which also means a state can always answer "why do you say that?".

`baseline` is the `Baseline` this was derived from, not a copy of its number.
Phase 31 already put value, spread, sample count, confidence and freshness on one
type; copying two of them here is how they come to disagree.

## Not a diagnosis, enforced by vocabulary

"Do not represent these states as diagnoses" is a rule about words, and words are
the one thing a type can hold exactly. So the state values are a closed set that
contains no clinical term — no `insomnia`, no `overtrained`, no `depressed`, no
`fatigued` in the medical sense — and a list of forbidden words is checked
against every member and every reason string. A state that cannot spell a
diagnosis cannot deliver one.

The reason is a sentence about *observations*: "you slept an hour below your
baseline, three nights running". Never about a cause, and never about a
condition.

## Categories, and the decimal that is allowed to remain

Every state is an enum. The only number that survives is `data_confidence`, and
it is a category too — Phase 31's `BaselineConfidence`. A "recovery score of 73"
is exactly the meaningless decimal the manifest is warning about: it implies a
precision that four nights of sleep cannot support, and people act on it.

## A state without evidence does not exist

If the baselines a state needs are missing, the state is `unknown` with a reason
saying which input was absent — not a middle value. A `moderate` produced by
having no data is indistinguishable from a `moderate` produced by measurement,
and only one of them should change a plan.

## Exit criteria

- All six named states, each a closed enum, each with an `unknown` member.
- `reason`, `baseline`, `confidence` and `freshness` are required and non-empty.
- No state value or reason may contain a clinical term, asserted against a word
  list.
- A state derived from a missing baseline is `unknown`, never a middle value.
- `data_confidence` is the weakest confidence among the inputs, not an average.
- `swift run MobileCoreCheck` still exits 0 and the iOS build still passes.
