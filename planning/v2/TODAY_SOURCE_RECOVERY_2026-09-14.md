# Today source-recovery repair

Updated 2026-09-14 21:47 BST. **100% of this bounded repair; installed build 232**, source `0404632`.

A late Calendar callback could restore an obsolete Reminders snapshot or let a preview be accepted after access was lost. Today now validates current read authorization, reminder errors and the captured task reading on callback, preview and acceptance. Changed tasks also trigger a refresh. Failed readings preserve accepted history; a successful refresh restores planning without restarting.

## Evidence

- Before the fix: five race tests produced nine assertion failures across three tests.
- First repair: 489 native tests and 40 connection checks passed.
- Final permission correction: 56 focused tests, including seven race tests, plus 40 connection checks passed. Independent final review found no remaining issue and independently passed all seven race tests.
- Source/history secret scan clean. Clean release checkout, signed build 232, matching designated requirements, and installed executable matching candidate verified.
- Actual installed Today source refresh and preview succeeded. Existing 22:30 commitment was preserved with an off-hours warning; the preview exposed insufficient free time and deferred one task. Preview discarded. Saved revision-8 plan fingerprint unchanged.

Permission revocation, callback ordering and recovery are controlled test evidence, not physical OS permission experiments. No external Calendar or Reminder record was changed. No phase or REC closure, remote push, gateway restart or permission change. Overall roadmap remains 45/85 phases marked complete (53%), not a product-readiness percentage.

## Files

- Model: [TodayPlanModel.swift](/Users/nickmadaio/Desktop/ORION/native/Orion/Sources/Orion/TodayPlanModel.swift)
- Regression tests: [TodayPlanSourceRaceTests.swift](/Users/nickmadaio/Desktop/ORION/native/Orion/Tests/TodayPlanAppTests/TodayPlanSourceRaceTests.swift)
- Release evidence: `/Users/nickmadaio/Desktop/ORION/.builds/today-source-race-2026-09-14/`
- Rollback: `.builds/today-source-race-2026-09-14/rollback/Orion-229.app`

Next: connected-client and durable-bridge gap inspection against the numbered manifest. Remaining physical permission and overlapping-event proofs stay explicitly unproven.
