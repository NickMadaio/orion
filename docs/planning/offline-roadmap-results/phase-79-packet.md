# Phase 79: Future Reservation Capability

## Baseline
- **Inspected source paths**: 
  - `docs/planning/v2/MANIFEST_PHASES.json` — phase definition and requirement list.
  - `scripts/orion_v2_deferred_check.py` — deferral enforcement for purchasing/banking/checkout patterns (Phase 76).
  - `plugin/orion-control/src/catalog.ts` — action catalog; confirms absence of booking/computer-use actions.
- **Limits**: No source changes. Investigation only. Phase 79 is deferred until computer-use surface exists (Phases 53–55).

## Requirement matrix
| ID | Status | Evidence / Source Symbol | Notes |
|----|--------|--------------------------|-------|
| waits_until_connectors_and_computer_use_are_safe | Passed (structural) | Absence of computer-use actions in `plugin/orion-control/src/catalog.ts`; Phases 53, 54, 55 remain open/blocked. No screen capture, input synthesis, or fetch primitive exists. | Prohibition holds by structural absence. |
| discovers_inspects_presents_books_and_records_a_reservation | Blocked | No booking flow code exists. Depends on browser/computer-use surface (Phases 53–55) which is not built. | Cannot build booking flow without safe browser driver. |
| never_allows_an_ambiguous_high_cost_booking_without_clear_intent | Passed (prohibition) | `scripts/orion_v2_deferred_check.py` enforces deferral of four patterns: autonomous purchasing, banking automation, autonomous payments, checkout shapes. Fails if any appear in catalog/scripts/allowlist. | Financial safety prohibition enforced by CI deferral check. |

## Architecture and interfaces
- **Producer**: Not yet built. Would be a booking service integrating with travel APIs or browser automation.
- **Consumer**: Not yet built. Would be the planner/calendar system (`SessionDomain` / `plugin/orion-control`).
- **Serialized fields**: N/A — no reservation data structures exist.
- **State ownership**: N/A — no reservation state is stored.
- **Errors**: N/A — capability is absent. The deferral check in `scripts/orion_v2_deferred_check.py` prevents accidental introduction of booking-related actions.

## Smallest next slice
**Blocker**: Cannot propose a bounded implementation contract because the prerequisite computer-use/browser surface (Phases 53–55) does not exist. Building a reservation flow without a safe way to drive a browser produces untestable code.

**Exact reconnaissance needed**: 
1. Completion of Phase 53 (Screen Observation Privacy Layer) or equivalent safe browser driver.
2. Verification that the deferral check in `scripts/orion_v2_deferred_check.py` correctly rejects booking-related action patterns.

No proposed contracts until the blocker is resolved.

## Test scenarios
- **Positive**: Run `python3 scripts/orion_v2_deferred_check.py`. Expected outcome: passes, confirming no purchasing/banking/checkout actions are present in the catalog or allowlist.
- **Failure**: Attempt to add a hypothetical `book_flight` action to `plugin/orion-control/src/catalog.ts`. Expected outcome: `orion_v2_deferred_check.py` fails with a deferral violation for "autonomous purchasing" or "checkout shapes".

## Gates and handoff
- **Entry gate**: Phase 78 (Future Travel Assistant). Phase 79 requires Phase 78 exit evidence.
- **Remaining hands-on proof**: 
  - Verify that `scripts/orion_v2_deferred_check.py` patterns cover all four financial safety categories mentioned in the brief.
  - Confirm no reservation-related code exists in `plugin/orion-control/src/` or `native/Orion/Sources/`.
- **Rollback**: N/A — no source changes made.
- **Reviewer handoff**: This report maps all 3 requirements to source evidence or blockers. No implementation is proposed due to the blocker. Reviewer should verify cited paths exist and that the deferral check patterns are correctly identified.
