# ORION v2 Phase 31 — Health Baseline Engine

Status: **planned — 2026-08-26**. Phase 30 closed the same day; this plan is
written while Phase 30's exit evidence is under independent review, and
implementation waits on that review.

## What the manifest asks for

Calculate personal baselines locally. Track sleep baseline, sleep consistency,
resting HR baseline, HRV baseline, activity baseline and training load. **Do not
compare users against generic population scores when personal baselines are more
useful.** Store data freshness. Store confidence. **Do not fabricate precision.**

## Where it lives

`native/OrionMobile/Sources/MobileCore/HealthBaseline.swift`, next to Phase 30's
local layer. "Calculate personal baselines locally" is the requirement and the
data is already local and deliberately not encodable; computing baselines on the
server would mean first inventing a way for the samples to leave.

## "Do not fabricate precision" is the rule with teeth

It is easy to satisfy in prose and easy to break in code, because every
statistical function in every language returns a `Double` with sixteen digits.
Three ways it will be broken and what stops each:

- **A baseline from too few nights.** Below a sample floor there is no baseline —
  `nil`, not a low-confidence number. The same shape as Phase 21's estimate
  learner, which declines rather than guessing, and for the same reason: a
  confident wrong number is worse than an absent one because it looks earned.
- **Digits the data does not support.** A resting heart rate baseline of
  `58.3719` from six readings claims a thousandth of a beat. The reported value
  is **quantised to a step the sample supports**, and the step widens as
  confidence falls.
- **A number that survives its own uncertainty.** Confidence and freshness are
  fields on the baseline, not metadata beside it, so a caller cannot read the
  value without having been handed both.

## Median and MAD, not mean and standard deviation

One two-hour night after a flight is not a fact about how somebody sleeps. The
mean moves with it; the median needs half the evidence to agree before it moves
at all. Spread is the median absolute deviation for the same reason. Phase 21
made this call for duration estimates and the argument is unchanged.

## No population table exists

"Do not compare users against generic population scores when personal baselines
are more useful" is usually implemented as a fallback that gets used every time
the personal baseline is missing — which is exactly when the comparison is least
useful and most likely to be believed. So there is no population constant to fall
back to. A missing baseline is `nil`.

That is the same rule as `AGENTS.md`'s **missing health data is not zero**, one
level up: a missing baseline is not the average person's baseline.

## Freshness is the age of the newest contributing sample

Not the age of the calculation. A baseline recomputed this morning from data that
stopped arriving three weeks ago is three weeks old, and reporting it as fresh is
the failure mode — a watch that stopped syncing produces a baseline that looks
current forever.

## Exit criteria

- All six named baselines, each with value, spread, sample count, confidence and
  freshness on the same type.
- Below the sample floor, `nil` — asserted for every baseline kind.
- No population constant exists anywhere in the module.
- A missing day is excluded from the window, never counted as zero — asserted
  against a window with gaps.
- The reported value is quantised, and the step widens as confidence falls.
- Freshness is derived from the newest sample, not from the calculation time.
- Training load reports acute, chronic and their ratio only when both windows
  have enough data; otherwise the ratio is absent rather than 1.0.
- `swift run MobileCoreCheck` still exits 0 and the iOS build still passes.
