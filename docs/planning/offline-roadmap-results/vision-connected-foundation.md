# Vision Connected Foundation: Phone Connection and Durable Service Recovery

## Baseline

**Inspected source paths:**
- `native/OrionMobile/App/PhoneHTTPReadSession.swift`: Simulator-only loopback bootstrap for phone read sessions. Defines `Bootstrap` struct (port, owner, device, token), `loadSetup()` validation, and `connect()` challenge-sign-exchange flow using ephemeral URLSession.
- `docs/planning/v2/PRODUCT_VISION_DELIVERY_2026-09-07.md`: Product vision delivery roadmap. Identifies gaps in phone connection, durable backend, and recovery gates REC-LIVE-FOUNDATION and REC-USABLE-CLIENT.

**Limits:**
- Phone source is simulator-only (`#if targetEnvironment(simulator)`). No real iPhone app target exists yet.
- Backend durability contracts exist but are not deployed; `backend/ownership.py` uses in-memory storage.
- No installed phone proof exists; only Mac-side readiness and Today/Plan slices are proven.

## Requirement Matrix

| Requirement ID | Capability | Source Evidence / Status | Notes |
|---|---|---|---|
| REC-LIVE-FOUNDATION | Durable owner/device inbox-outbox and crypto | Not yet proven — needs backend durability implementation review | Brief states "Missing production service; audited contracts exist." `backend/ownership.py` is in-memory. No durable repository or crypto implementation found in scope. |
| REC-USABLE-CLIENT | Real SwiftUI Today/Plan/conversation shell with durable sync | Not yet proven — needs iPhone app target creation | Brief states "Partial remote transport; missing iPhone application." No installable iPhone target exists. |
| REC-LIVE-PAIRING | Device pairing and bootstrap validation | Built (simulator only) — `PhoneHTTPReadSession.loadSetup()` validates bootstrap JSON with owner/device/token constraints | Only works in simulator via loopback. No real device pairing flow implemented. |
| REC-LIVE-REVOCATION | Session revocation and stale state handling | Not yet proven — needs revocation endpoint review | `PhoneHTTPReadSession.connect()` calls `reader.refuseDeviceSession()` on error, but no revocation authority or stale-state detection found. |
| REC-LIVE-AUTH-READS | Authenticated read session challenge/sign/exchange | Built (simulator only) — `PhoneHTTPReadSession.connect()` implements challenge-sign-exchange with `identity.signReadSessionChallenge()` | Uses ephemeral URLSession, bounds response size, validates token schema/owner/device. Simulator-only. |
| REC-LIVE-RECONNECT | Reconnection after interruption | Not yet proven — needs reconnect logic review | No reconnect retry or state recovery found in `PhoneHTTPReadSession`. Errors call `refuseDeviceSession()` but do not retry. |
| REC-LIVE-STALE | Stale/offline state visibility | Not yet proven — needs stale-state handling review | Brief requires "unknown/stale data is never zero or success." No implementation found for phone-side stale detection. |

## Architecture and Interfaces

**Producer:** `PhoneHTTPReadSession` (Swift, simulator-only) produces a read session token via challenge-sign-exchange with a local HTTP server on loopback.

**Consumer:** `PhoneTodayReader` (referenced in `connect()` signature) consumes the token via `reader.useDeviceSession(port:owner:token:)`. Actual implementation not inspected; assumed to be in MobileCore or OrionMobile UI layer.

**Serialized fields:**
- `Bootstrap`: port (Int), owner (String), device (String), token (String, 32–128 ASCII chars)
- `DeviceReadChallenge`: challenge data (decoded from JSON, schema not fully inspected)
- `TokenResponse`: schema (Int), ownerID (String), deviceID (String), token (String)

**State ownership:**
- Bootstrap JSON stored in app document directory (`http-session-bootstrap.json`), max 4096 bytes.
- Session state is ephemeral: `URLSessionConfiguration.ephemeral`, no cookies/credentials cached.
- Token stays in app process; not persisted to disk after exchange.

**Errors:**
- `URLError(.badURL)` on bootstrap validation failure or file size exceeded.
- `URLError(.badServerResponse)` on HTTP status != 200, wrong MIME type, or response > 8192 bytes.
- `URLError(.dataLengthExceedsMaximum)` if streaming body exceeds 8192 bytes.
- Task cancellation checked at three points; errors call `reader.refuseDeviceSession()`.

## Smallest Next Slice

**Blocker:** No real iPhone app target exists. REC-USABLE-CLIENT requires an installable phone shell before any connected slice can be proven on device. Simulator-only proof is insufficient for "usable client" acceptance.

**Proposed reconnaissance needed:**
1. Confirm whether an iPhone app target exists in the Xcode project (search `native/OrionMobile/` for `.xcodeproj` or `Package.swift` targets).
2. Identify `PhoneTodayReader` implementation to understand what `useDeviceSession` actually does.
3. Locate backend durability contracts (`backend/ownership.py`, FastAPI handlers) to assess REC-LIVE-FOUNDATION gap.

**Proposed contract (conditional on reconnaissance):**

1. **Create iPhone app target with Today view shell**
   - Scope: `native/OrionMobile/` — add iOS application target, minimal SwiftUI shell showing Today state
   - Acceptance: App builds and runs in Simulator; displays placeholder Today content; no crashes on launch
   - Dependencies: Existing MobileCore package; `PhoneTodayReader` implementation must exist
   - Blocker if: No `PhoneTodayReader` found in MobileCore or OrionMobile sources

2. **Wire phone read session to local gateway**
   - Scope: `native/OrionMobile/App/PhoneHTTPReadSession.swift`, `native/OrionMobile/Sources/MobileCore/` — connect existing challenge-exchange flow to real gateway endpoint
   - Acceptance: Simulator app successfully exchanges challenge/signature for token; `useDeviceSession` called with valid token; error paths call `refuseDeviceSession()`
   - Dependencies: Gateway `/session/challenge` and `/session/exchange` endpoints implemented and running on loopback
   - Blocker if: Gateway session endpoints not implemented or not reachable from Simulator

3. **Add durable backend repository stub**
   - Scope: `backend/ownership.py`, `backend/adapters/fastapi_app.py` — replace in-memory storage with file-backed or SQLite repository for owner-scoped records
   - Acceptance: Owner/device records persist across process restart; read/write round-trip tested; revocation endpoint exists
   - Dependencies: Existing ownership contract types; FastAPI handler registration
   - Blocker if: No reviewed ownership contract types found; backend not registered in project

## Test Scenarios

### Positive scenarios

| Scenario | Seam / Inject point | Expected state | Product-visible result |
|---|---|---|---|
| Phone read session succeeds (simulator) | `PhoneHTTPReadSession.connect()` with valid bootstrap JSON and running gateway | Token exchanged; `reader.useDeviceSession()` called with valid port/owner/token | Today view shows connected state; no error banner |
| Bootstrap validation rejects malformed file | `loadSetup()` with oversized or invalid-token bootstrap JSON | `URLError(.badURL)` thrown; `connect()` does not proceed | Connection attempt fails gracefully; no crash |
| Challenge-sign-exchange completes | Gateway `/session/challenge` returns valid challenge; `identity.signReadSessionChallenge()` succeeds; `/session/exchange` returns matching token | `TokenResponse` decoded; schema/owner/device validated; session established | Phone UI transitions from "connecting" to "connected" |

### Failure scenarios

| Scenario | Seam / Inject point | Expected state | Product-visible result |
|---|---|---|---|
| Gateway unreachable | `URLSession` request times out or fails with network error | `reader.refuseDeviceSession()` called; no token persisted | Today view shows "unavailable" or "degraded" state; retry option visible |
| Token validation fails (wrong owner/device) | `/session/exchange` returns token with mismatched `ownerID` or `deviceID` | `URLError(.badServerResponse)` thrown; session refused | Connection fails; error logged; no stale token cached |
| Response body exceeds size limit | Gateway returns >8192 bytes on challenge or exchange | `URLError(.dataLengthExceedsMaximum)` thrown during streaming read | Request aborted; session refused; no partial data used |
| Task cancellation during connect | `Task.checkCancellation()` triggered mid-flow | Session setup aborted; `reader.refuseDeviceSession()` called if not cancelled | Connection attempt stops cleanly; UI reflects cancelled state |

**Fixture vs. device proof:** All scenarios above are fixture-based (Simulator, loopback gateway). Installed device proof requires: real iPhone target, physical biometric approval test, APNs notification delivery, and offline/stale-state recovery on actual hardware. These remain future gates.

## Gates and Handoff

### Entry gate
- REC-LIVE-FOUNDATION and REC-USABLE-CLIENT are registered but not closed; this report maps their current state and remaining gaps.
- No phase numbers are renumbered or closed by this document.
- Provider selection for hosted backend is deferred until local durability is proven.

### Remaining hands-on proof required
1. **iPhone app target creation** — must exist before any phone-side connected slice can be tested on device. Simulator-only proof is insufficient for REC-USABLE-CLIENT acceptance.
2. **Gateway session endpoints** — `/session/challenge` and `/session/exchange` must be implemented and reachable from Simulator loopback. Current evidence shows gateway health endpoints work; session endpoints are not proven.
3. **Durable backend repository** — `backend/ownership.py` uses in-memory storage; must be replaced with file-backed or database repository before REC-LIVE-FOUNDATION can claim durability.
4. **Physical device proof** — biometric approval, notification delivery, offline recovery, and revocation must be tested on real hardware, not Simulator.

### Rollback
- This report is documentation only; no source files were changed.
- If reconnaissance reveals that proposed contracts are infeasible (e.g., no `PhoneTodayReader` exists, gateway session endpoints cannot be added within scope), the next step is to record the blocker and request a provider decision on whether to invest in phone target creation or defer REC-USABLE-CLIENT.

### Reviewer handoff
- Verify that every requirement row cites real source paths or explicitly states "unknown" with reconnaissance needed.
- Confirm that proposed contracts do not exceed scope (no source changes authorized by this report).
- Check that test scenarios distinguish fixture from installed proof and do not claim unexecuted tests passed.
- Ensure no phase numbers are renumbered, no recovery gates are closed, and no provider is selected.
