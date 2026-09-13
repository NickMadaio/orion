# Grounded daily brief — 2026-09-12 16:40 BST

## Problem and resulting behavior

Build 221's optional model paragraph claimed a full day was available late in the afternoon. It also described health data as several days old because the brief passed no reading age. Changing instructions alone would leave unsupported model sentences on screen.

The app now renders its own current-time calendar and Orion Reminders summary. It distinguishes remaining timed events, all-day context, unavailable sources, due/overdue items and unfinished work without a deadline. An empty calendar never becomes a promise of free time. The summary is present even if the local model is unavailable or returns malformed output.

The local model may select one supported detail using a small JSON response. The actual view parses that selection against the current set of facts; it never renders model-written prose. Unknown IDs, extra fields, freeform text and oversized replies fall back to the factual summary. A versioned cache excludes old freeform paragraphs, and every cached response is validated at rendering. Minute ticks update the visible observation time without requesting another selection when semantic facts are unchanged.

## Source provenance and privacy

Recovery, sleep and cycle records can have different periods. Recovery provenance now follows its sleep ID to that sleep's end; sleep keeps its own end; the conservative aggregate age uses cycle start for strain. Fetch, creation and edit timestamps do not substitute for measurement periods in brief freshness. Missing, invalid and future ages are unknown. A duplicate record's update timestamp breaks selection ties but never freshens its measurement age.

This follows WHOOP's distinctions between recording/edit times and linked sleep/physiological-cycle periods: [Recovery](https://developer.whoop.com/docs/developing/user-data/recovery/), [Sleep](https://developer.whoop.com/docs/developing/user-data/sleep/), [Cycle](https://developer.whoop.com/docs/developing/user-data/cycle/).

Health details carry only derived recovery categories and explicit source dates. No raw recovery, sleep, heart-rate or variability values enter the brief model request. Fixed score thresholds are not described as Nick's personal baseline; missing strain cannot become a claim that no training happened. Existing Health tab interpretation and other freeform narrative consumers are outside this repair.

## Review and verification

The full native wrapper passed 467 XCTest cases, 26 gateway health checks, nine transport scenarios and five menu checks. Twelve new brief tests cover malicious model output, afternoon availability, unknown sources, unfinished tasks, semantic cache changes, all-day and ongoing events, mixed-age/edited/future records, duplicate versions, source-title injection and raw-health isolation. The existing health privacy harness passed 38 checks. Independent review reran all 12 new tests and found no remaining actionable issues after repair.

Two defects were found during validation: default JSON field order changed the cache key for identical facts, fixed with canonical sorted keys; embedded quote and directional controls in source titles could make data read as Orion's own statement, fixed by normalizing delimiters and removing bidi controls on the summary path. A small final wording refinement makes six-hour/two-day freshness boundaries exact; focused tests and the health harness cover the final wording.

Source/history secret scan passed with the existing reviewed fixture allowlist. This record initially describes source verification; installed proof is added after the signed candidate is checked. Build 221 is currently installed. The only pre-existing dirty file, `planning/learning-proposals.md`, is excluded.

## Decisions, boundaries and next gate

Prompt-only steering and a second model judging arbitrary prose were rejected: neither gives a deterministic boundary for displayed claims, and a second request adds latency. Constrained selection keeps useful emphasis while the app owns factual wording. General conversation and action execution are unaffected.

No new model/provider, permission, credential, external task/calendar write or remote push is needed. The local plan file must remain unchanged during verification. Release from a clean checkout using the existing designated requirement, retaining a verified build-221 rollback under `.builds/brief-release-2026-09-12/`.

Next: install the reviewed candidate and prove an actual late-afternoon brief with current source data, including a valid selected detail when the local model returns one. This does not establish medical interpretation, overall health-card freshness, phone/backend continuity or the remaining live Today conflict scenarios. REC-USABLE-CLIENT remains open.

## 2026-09-12 16:44 BST — build 223 installed; visible launch check pending

The reviewed source was checkpointed locally as `dfcaee2`. A clean detached checkout produced Orion 1.2.0 build 223 in 34.50 seconds. Candidate, rollback and installed deep/strict signature checks pass; the designated requirement exactly matches the existing Orion identity. The final 12-case focused suite and 38-case health firewall also pass after the boundary wording refinement. The final source/history secret scan is clean.

Build 223 is now installed at `/Applications/Orion.app`. Orion was not running, so no active app or focus session was interrupted. The local plan fingerprint remained unchanged. Build 221 is retained at `.builds/brief-release-2026-09-12/rollback/Orion-221.app`, with a second prior bundle recorded in `install.json`. Source/test/build/install manifests are in that release directory. No gateway restart, permission change, credential access, external record change or remote push occurred.

Computer Use reported that the Mac is locked and could not unlock it automatically. The user was asked to unlock it. Build 223 has therefore NOT been launched or verified through the ordinary visible brief route. No synthetic rendering or test result substitutes for this missing installed observation. Earlier build-221 UI proof remains historical to that binary.

Exact next step after unlock: open `/Applications/Orion.app`, select Today and Read today's brief if parked, inspect the deterministic late-day summary and its actual source counts; allow the local model to return a choice and confirm a dated supported detail or an unchanged valid fallback. Verify the stored plan is unchanged. Use the existing release manifests and actual date when appending the result. Do not install again, change permissions or regenerate the signing identity. The remaining normal-route Today conflict scenarios and phone/backend work are still open.

## 2026-09-13 15:39 BST — live fallback verified; structured client mismatch repaired

The Mac was unlocked. Installed build 223 launched normally and showed the correct Sunday afternoon date/time, one real all-day calendar entry, no remaining timed events, and one unfinished Orion reminder despite nothing being due. Its clock advanced visibly. The Tasks tab independently showed the same unchecked source reminder and 0/1 done. The saved revision-8 plan remained byte-for-byte unchanged; the installed signature still verifies.

The optional AI detail did not appear. The actual application log reported a truncated sentence for the brief-choice request. Source tracing found the integration error: NarrativeWriter used LocalModel's default sentence-ending validation for a JSON object. This rejects every valid choice ending in a closing brace, before the brief's schema validation sees it. Earlier pure rendering tests had not crossed that client boundary.

Repair: an explicit selectionJSON style bypasses prose punctuation and all prose cleanup only for the structured brief. Other narrative consumers preserve their defaults. The response decoder used by the real transport is also exercised through the actual writer and rendering/cache path with isolated preferences. Four regressions cover accepted JSON, cache reuse, preservation/rejection of labeled/quoted/fenced/malformed/trailing/extra-field output, stale completions and thinking-only output. The full native wrapper passes 471 XCTest cases and all 40 connection checks. Independent review reran the four boundary tests and found no unresolved actionable issue.

This is a source repair pending clean signed update and actual model-selection proof. Build 223 remains installed until that step. Source reminder, saved plan, permissions and gateway are unchanged. No remote push or gate closure.
