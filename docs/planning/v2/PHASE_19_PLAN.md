# ORION v2 Phase 19 — Today Screen

Status: **planned — 2026-08-25**. Phase 18 closed the same day.

## What the manifest asks for

The default mobile dashboard: current ORION summary, next events, priorities,
relevant tasks, action inbox, health state once available, important
notifications, ORION recommendations. **Do not turn it into a giant metrics
dashboard.** Prioritise state, meaning and action over raw numbers.

## Two instructions that are really one rule

"Do not turn it into a giant metrics dashboard" and "prioritise state, meaning,
action over raw numbers" are the same instruction from two directions, and both
are easy to agree with and hard to keep. A dashboard becomes a metrics wall one
useful-looking number at a time, and every one of them is defensible on its own.

So it is enforced by the type rather than by taste:

- every item carries a **sentence** — what this means — and it cannot be empty;
- a **number is optional supporting detail**, never the item itself;
- an item is one of **state**, **meaning** or **action**, and the screen orders
  those three in that order;
- sections and items are **capped**, and a section with nothing to say is
  omitted rather than rendered empty.

An item that is only a number cannot be constructed. That is the whole design.

## "Health state once available"

Phase 16 defers HealthKit to Phase 30, so the health section is behind a flag
that is off, and the check asserts that the section does not appear while it is.
"Once available" in a plan document is a section somebody adds early because the
mock had a gap.

## Where it lives

`MobileCore`, alongside Phase 16's models, and for the same reason: it is the
decisions, not the rendering. The SwiftUI view will read `TodayModel` and choose
fonts.

## Exit criteria

- All eight sections modelled, health gated off.
- An item with no meaning cannot be constructed; a number cannot be an item.
- state → meaning → action ordering, asserted.
- Section and item caps, with an empty section omitted rather than shown.
- `swift run MobileCoreCheck` still exits 0.
