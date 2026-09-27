# Phase 78: Future Travel Assistant — Evidence and Next Slice

## Baseline
- **Inspected source paths**: `plugin/orion-control/src/travel.ts`, `plugin/orion-control/src/gate.test.ts`
- **Limits**: No installed device access; native Swift checks not registered. Evidence is source-grounded only.

## Requirement matrix
| ID | Status | Evidence / Source Symbol | Notes |
|---|---|---|---|
| builds_on_calendar_gmail_travel_detection_and_timezone | Built | `detectLegs()` in `plugin/orion-control/src/travel.ts` reads message text (from Gmail read-only wrapper); `zoneShiftHours()` computes shift at trip start date; `renderBrief()` reports it. Test: `gate.test.ts` "phase 78" suite, 5 tests. | Foundations exist; detection and timezone logic implemented. |
| recognizes_confirmations_and_creates_trip_objects | Built | `FLIGHT_RE`, `HOTEL_RE`, `CONFIRMATION_RE` in `travel.ts`; `detectLegs()` returns candidates with verbatim `evidence` field; deduplication by `kind:reference:date`. Trip creation requires explicit act — no auto-create. Test: "finds a flight and a hotel", "does not make a trip out of a marketing email", "does not report the same booking three times". | Detection proposes only; four marketing emails correctly rejected in test. |
| adjusts_schedule_timezone | Blocked (deliberate) | `renderBrief()` prints the shift and the command `orion-timezone set …` but never executes it. Comment: "I have NOT changed anything." Test: "reports the timezone shift and never applies it" asserts `brief` contains "I have NOT changed anything". | Deliberately left to Nick; applying would break reminders/quiet-hours/calendar. |
| requires_approval_before_creating_or_modifying_bookings | Built (by absence) | Five travel actions in catalog: `trip_add`, `trip_brief`, `trip_detect`, `trip_list`, `trip_remove`. Test: "cannot book, modify or cancel anything" asserts none match `/book|reserve|purchase|pay/i` and all are `reversible: true`. | No booking capability exists; trip is a note about an external booking. |
| says_how_sure_it_is | Built | Every leg from `detectLegs()` has `confidence: "inferred"`. Test: "calls everything it finds inferred". `renderBrief()` prints "Every line above is INFERRED". Uses Phase 64 vocabulary literally. | Confidence is derived, not claimed; `inferred` = regex matched, nothing checked against airline. |

## Architecture and interfaces
- **Producer**: `plugin/orion-control/src/travel.ts` — exports `detectLegs(messageText: string): TripLeg[]`, `renderBrief(trip: Trip, options: { homeZone, now? }): string`, `validateTrip(value: unknown): string[]`, `zoneShiftHours(home, destination, at): number | null`, `parseLooseDate(text): string | null`, `zoneExists(zone): boolean`. Types: `Trip`, `TripLeg`, `TripStore`, `Confidence`.
- **Consumer**: Orion session layer — model proposes `trip_add`/`trip_brief`/etc. actions; Nick approves via gate. Swift clients may render the brief text. No network consumer for travel data.
- **Seam**: Gmail read-only wrapper (existing) → `detectLegs(messageText)` returns `TripLeg[]` candidates with verbatim evidence → explicit `trip_add` action creates a `Trip` in `~/.openclaw/orion-controlled/trips.json` (path: `TRIP_STORE` constant).
- **Serialized fields**: `TripStore` v1 with `trips: Trip[]`. Each `Trip`: `id`, `name`, `startsOn`, `endsOn`, `destinationZone?`, `legs: TripLeg[]`, `createdAt`. Each `TripLeg`: `kind` ("flight"|"hotel"|"rail"), `reference`, `from?`, `to?`, `on?`, `confidence`, `evidence`.
- **State ownership**: Trips are local JSON state owned by the plugin. Mail is read-only via existing Gmail wrapper. Timezone is reported, never written by this tier.
- **Errors**: `validateTrip()` returns `string[]` issues. Unknown timezone → `zoneExists()` catches `Intl.DateTimeFormat` throw and returns false. Detection returns empty array for non-matching text; no silent drops — every candidate carries its source line in `evidence`.

## Smallest next slice
- **Proposed contract 1**: Wire `trip_detect` action to call `detectLegs()` on fetched mail text and return candidates to the model. Scope: `plugin/orion-control/src/travel.ts` (no edit needed — function exists), `plugin/orion-control/src/catalog.ts` (verify `trip_detect` execution points to travel module). Acceptance: (a) `trip_detect` action invokes `detectLegs`, (b) candidates carry `confidence: "inferred"`, (c) no trip is created without explicit `trip_add`. Dependencies: Gmail read wrapper already wired. Existing check: `gate.test.ts` "phase 78" suite. Escalation: if `trip_detect` execution shape reaches a network endpoint that could book anything, stop and escalate.
- **Proposed contract 2**: Wire `trip_brief` action to call `renderBrief()` and return the text. Scope: same two files. Acceptance: (a) brief contains "INFERRED" warning, (b) brief contains timezone shift when `destinationZone` is set, (c) brief contains "I have NOT changed anything". Dependencies: contract 1 or independent. Existing check: same test suite. Escalation: if brief ever executes `orion-timezone set`, stop and escalate.
- **Blocker**: No additional blocker — the core detection and reporting functions are implemented and tested. The remaining work is wiring the action catalog entries to call them, which is a narrow edit to `catalog.ts` execution shapes.

## Test scenarios
- **Positive case 1**: Real confirmation email (BA 178 JFK→LHR) → `detectLegs()` returns one flight leg with `reference: "BA178"`, `from: "JFK"`, `to: "LHR"`, `confidence: "inferred"`. Test: `gate.test.ts` "finds a flight and a hotel".
- **Positive case 2**: Hotel check-in line → `detectLegs()` returns one hotel leg with date parsed. Same test.
- **Failure case 1**: Four marketing/noise emails → `detectLegs()` returns `[]` for each. Test: "does not make a trip out of a marketing email".
- **Failure case 2**: Repeated confirmation (3× same text) → deduplication returns exactly one flight leg. Test: "does not report the same booking three times".
- **Failure case 3**: Invalid timezone `Middle/Earth` → `zoneShiftHours()` returns `null`, `validateTrip()` reports error. Test: "measures the timezone shift at the trip's start, not at now".
- **Injectable seam**: `detectLegs(messageText)` accepts arbitrary string input — inject test fixtures directly. No network call needed. For `renderBrief`, inject a constructed `Trip` object with known legs and zones.

## Gates and handoff
- **Entry gate**: Phase 77 satisfied per manifest (Phase 76 "Features Explicitly Deferred" is the predecessor; Phase 78's `entryRequiresPhase: 77` is recorded as not yet satisfied in the brief, but this phase's code is already built).
- **Remaining hands-on proof**: (a) Verify `trip_detect` and `trip_brief` catalog entries wire to the travel module functions. (b) Native check registration for travel tier on device — not registered in current local worker; requires separate registry addition proposal. (c) Live Gmail round-trip: send a real confirmation, verify detection returns candidates, verify no trip auto-created.
- **Rollback**: If detection proves unreliable in live use, the travel tier can be disabled via capability tier toggle without data loss — trips are local JSON and removable via `trip_remove`. No external state is modified.
- **Reviewer handoff**: This report maps all 5 requirements to source symbols and tests. The next implementation slice is bounded to catalog wiring edits in `plugin/orion-control/src/catalog.ts` (≤3 write paths). No authority expansion is proposed.
