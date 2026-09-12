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
