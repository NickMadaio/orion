# Today/Plan installed verification and brief repairs

Recorded 11 September 2026. This continues the product-vision delivery plan and the 8 September Today/Plan source checkpoint. It does not close REC-USABLE-CLIENT or a numbered phase.

## Installed evidence

The previous handoff stopped at source commit `187fa15` and installed build 217. Work continued: a clean detached checkout at that commit produced signed build 220, which replaced `/Applications/Orion.app`. Its designated requirement matches the installed identity exactly. The gateway was not restarted. No new account, permission or credential was required.

Actual app checks on 10 September around 03:21–03:31 BST read Calendar and the Orion Reminders list. That day's Calendar had zero commitments and Reminders contained one unfinished task. The app created a reviewable 30-minute slot, accepted it, pinned it, preserved it during Running late, and refused an incompatible duration change while pinned. An expired proposal was visibly refused.

A restart recovered accepted revision 3 and its pin. The local plan file was byte-for-byte unchanged (SHA-256 `524a5ad58daef168f8932cac1abf88b0b4272ca0140d9a650a63081343fc055d`). Finish block then Undo restored the unfinished local block. Unpin, add 15 minutes, accept and Undo restored its original 30 minutes. Final verification state is revision 8, unfinished and unpinned. The Tasks tab still showed 0/1 done and its source reminder unchecked. No external reminder or calendar record was changed by this verification.

These are actual installed UI observations, not fixture renders. The earlier preview PNGs remain labeled source-view fixtures. The empty live calendar does not prove overlapping calendar commitments or a missed gym scenario; those remain domain/fixture evidence.

## Defects found and repair

The installed brief at 03:21 on 10 September labeled the agenda as 9 September. It mixed Orion's intentional 4am activity boundary with the civil date used by Calendar and Reminders. A separate observation clock now drives the brief date, greeting, event selection, due-date classification and narrative identity. The activity-day rule remains in place. A 30-second foreground tick advances facts and detects midnight and time-zone changes without waiting for new health data.

Independent review found within-hour stale prose, time-zone detection that lost the prior zone, a calendar permission check incorrectly used as evidence of coverage, and date-only reminders displayed as midnight. Repairs preserve the previous clock's zone, require a fresh complete calendar-day reading, show unknown/stale source text, and display date-only deadlines as today. Calendar refresh results carry their actual window and zone; superseded asynchronous fetches cannot replace newer state. The narrative view rejects text whose key no longer matches its facts, and ticks clear obsolete prose without requesting model work each minute.

The installed app also lacked the standard Quit shortcut and a window reopen handler. Both are now implemented. Installed verification of build 221 is recorded below.

## Validation and release boundary

The full native suite passed 455 XCTest cases with zero failures, including seven brief regressions. The standard wrapper also passed 26 gateway health checks, nine transport scenarios and five menu checks. Independent review found no remaining actionable issues and independently passed seven brief tests. Its concurrent wrapper run encountered one redirect timeout (unavailable instead of unverified); an isolated gateway rerun passed all 40 checks. The main full wrapper passed without a rerun. Source/history secret scan is clean with the existing reviewed fixture allowlist.

Remaining limits: a calendar window outside today now gives honest unavailable copy; the brief does not independently fetch today, while the Today planner does. The asynchronous calendar generation guard was inspected in source, without an injected EventKit race.

Release requires a clean source checkout, a signed candidate with the exact existing designated requirement, deep signature verification, an inactive focus session, a verified local rollback, and an installed UI pass. Tests alone do not establish the installed behavior of these repairs.

## Rollback and next gate

Build 217 remains at `.builds/today-release-2026-09-08/rollback/Orion.app`, plus the hidden previous bundle identified in that directory's `install.json`. Build 220's source and build log remain in the same release directory. Local plan data is not removed on application rollback. Source-only rollback uses a forward revert of the scoped repair checkpoint, not history rewriting. The unrelated `docs/planning/learning-proposals.md` edit remains excluded.

After this repaired Mac release, finish the remaining Today acceptance scenarios through a controlled normal route, then the delivery plan's real phone shell and minimal durable bridge. Phone installation, durable backend and cross-device continuity remain unproven. No remote push or backup claim is made.

## 2026-09-11 16:54 BST — repaired release installed and checked

Build 221 (1.2.0), from clean source `12583fc`, is installed at `/Applications/Orion.app`. Candidate production compilation took 35.02 seconds. Candidate and installed deep/strict signature verification pass; the designated requirement matches the existing identity exactly. Build 220 is retained at `.builds/today-release-2026-09-11/rollback/Orion-220.app`, plus the hidden previous application identified in `install.json`. Build/install/test/scan records are under `.builds/today-release-2026-09-11/`; the clean release checkout remains under the 8 September release directory.

The actual installed app showed Friday, September 11, the afternoon greeting and the current civil-day brief. Command-Q terminated its installed process. Launch reopened the app; closing the window and reopening Orion through Finder restored the Command Center. Calendar and Orion Reminders refreshed successfully. A fresh Today preview scheduled the unfinished source task for 16:53–17:23, followed by 277 minutes of intentional free time ending at 22:00. The expanded production UI was inspected visually and through accessibility. The verification preview was discarded. The saved revision-8 plan remained byte-for-byte unchanged through install, launch, quit, reopen and this preview. No new permission prompt was observed.

This daytime installed check proves the corrected date path for the actual observation date; early-hours, midnight, time-zone transition, within-hour prose invalidation and stale/out-of-window source cases are regression-test/source evidence, not all live-clock experiments. The permission-revocation and real overlapping-commitment cases remain unperformed. Existing 448-test/pinning/mobile evidence is historical to its source checkpoint; this repair's 455 native tests and 40 connection checks are current.

One additional installed observation remains open: the optional model paragraph used “full day” wording late in the afternoon, while the structured Today proposal correctly budgeted only the remaining hours. Cache/freshness repair does not certify generated prose as factually faithful. The next bounded repair should ground narrative in the observation time and actual source age, with checks against unsupported duration/freshness claims, before broadening the phone work. No health interpretation was verified in this release.

Local checkpoint `12583fc` contains the repair and pre-install report. This post-install evidence is a documentation follow-up; the installed source fingerprint remains `12583fc`. No remote push occurred, no recovery gate is closed, and phone/backend continuity is still unproven.
