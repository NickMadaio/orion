# Phase 77: Future Apple Watch Expansion — Implementation Packet

## Baseline

| Item | Value |
|------|-------|
| Snapshot commit | 9855d99 (2026-09-26) |
| Inspected source paths | `native/OrionMobile/Sources/MobileCore/Health.swift`, `native/OrionMobile/Sources/MobileCoreCheck/main.swift` |
| Limits | No iOS app target exists; no ORION Mobile layer; Keychain/TCC grants bound to existing designated requirement. Watch expansion is parked until Nick is at the keyboard. |

## Requirement matrix

| Requirement ID | Status | Source symbol / Evidence | Notes |
|----------------|--------|--------------------------|-------|
| creates_a_lightweight_watch_companion | blocked | `HealthDevice.watch.mayReadHealth` returns `false`; `HealthAuthorizationLedger` throws `HealthError.notOnThisDevice` for `.watch`; no WatchKit target or adapter exists in source. | Blocked on absence of iOS app and risk to designated requirement (TCC/Keychain). Parked until Nick is at keyboard. |
| does_not_make_watch_the_source_of_truth | passed | `MobileCore` imports only `Foundation` (verified by `MobileCoreCheck` scan); `HealthStore` is a protocol with `RefusingHealthStore` default; no persistence layer in MobileCore. | Holds by prohibition and absence. Watch would be a view, not a source of truth. |

## Architecture and interfaces

**Producer**: `SessionService` (Mac) and `MobileCore` (Phone) own durable state and health data via `HealthStore` protocol.
**Consumer**: A future Watch companion would read from these stores via a narrow sync seam, not write to them.
**Proposed Seam**: `HealthReading` enum in `native/OrionMobile/Sources/MobileCore/Health.swift`. This type is `Sendable`, `Equatable`, and deliberately **not** `Codable` (no JSON form), preventing accidental upload or persistence without explicit encoder implementation.
**State Ownership**: All state remains on Mac/Phone. Watch is a read-only view.
**Errors**: `HealthError.notOnThisDevice` prevents watch-side authorization requests. `RefusingHealthStore` ensures no plausible numbers are returned if an adapter is missing.

## Smallest next slice

**Blocker**: No iOS app target exists. Creating one changes the app bundle's designated requirement, which every TCC grant and Keychain item on this machine is bound to. This requires Nick at the keyboard for security decisions.

**Exact reconnaissance needed**:
1. Confirm no WatchKit target or stubs exist in `native/OrionMobile` or `plugin/orion-control`.
2. Verify that adding a Watch target would require a new App ID and thus break existing TCC/Keychain grants.

**Proposed contract (conditional on Nick's approval)**:
- **Objective**: Create a read-only Watch complication showing current health state summary.
- **Scope**: `native/OrionMobile/Sources/MobileCore/Health.swift` (read-only), new Watch target.
- **Constraints**: No writes to MobileCore stores; no new TCC requests on Watch; use existing `HealthReading` types.
- **Acceptance**: Complication displays "No data" if store is refusing; displays summary if available.

## Test scenarios

**Nearest existing suite**: `native/OrionMobile/Sources/MobileCoreCheck/main.swift` (executable assertions).

| Scenario | Type | Injectable seam | Expected outcome |
|----------|------|-----------------|------------------|
| Watch device attempts health authorization | Failure | `HealthAuthorizationLedger(device: .watch)` | Throws `HealthError.notOnThisDevice`; no state change. |
| Refusing store returns plausible numbers | Failure | `RefusingHealthStore().read(.sleep, ...)` | Throws `HealthError.unavailable`; no samples returned. |
| Health sample is encoded to JSON | Failure | Attempt to cast `HealthSample` to `Encodable` | Fails at compile time; type is not `Codable`. |
| Watch reads health data via adapter | Positive (future) | Mock `HealthStore` returning `.samples` | Returns `HealthReading.samples`; no write occurs. |

## Gates and handoff

| Gate | Status | Notes |
|------|--------|-------|
| Entry gate (Phase 76) | Satisfied per brief | entryRequiresPhase: 76, entrySatisfied: true |
| Remaining hands-on proof | Blocked | Needs Nick at keyboard for TCC/Keychain decisions and App ID creation. |
| Rollback | N/A — no source changes in this phase | Report-only investigation. |
| Reviewer handoff | Ready | Report cites specific symbols (`HealthDevice.watch`, `RefusingHealthStore`, `HealthSample` non-Codable) and test assertions in `MobileCoreCheck`. |
