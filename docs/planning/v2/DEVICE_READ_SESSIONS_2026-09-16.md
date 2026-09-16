# Device-bound local read sessions — 2026-09-16

Bounded local session enforcement now connects device registration/revocation to
GET /plan. Overall roadmap remains45/85 phases marked complete (53%). This does
not establish production account authentication or physical-phone connectivity.

## Behavior and boundaries

`backend/local_today/device_sessions.py` adds DeviceReadSessions. A trusted local
caller supplies an existing server-resolved Owner and registered device ID.
Issuance requires a fresh, single-use signature over a domain-separated message
binding owner, device ID, registered public key and server challenge. Challenges
expire after five minutes; a failed signature spends the challenge. Issuance
checks registry trust inside the durable transaction, so revocation between
challenge and exchange refuses the grant. No unauthenticated sign-in endpoint
or caller-supplied owner query is added.

Grants are opaque random bearer tokens stored as hashes in memory. Default
lifetime300seconds, existing ceiling3600; restart invalidates all tokens and
outstanding challenges. There is no refresh endpoint or durable session token
storage. Every resolve reloads current registered-device state. Missing/revoked
or failed-attestation devices lose access, and observed trust failure retires
that token. Restoring attestation cannot revive a retired token. Storage errors
refuse the request with503 without silently trusting cached device state.

The HTTP boundary accepts the resolver protocol and maps resolution failure to
503. Registry revocation produces401. An already authorized in-flight response
may finish; a subsequent request after committed revocation refuses. This is
loopback-only HTTP and read-only Today scope, not TLS/remote transport, token
binding on every request, or permission for remote writes/actions.

Existing LocalReadSessions remains explicitly a legacy harness credential; the
personal-plan preview still uses it. The updated Simulator read harness uses
DeviceReadSessions with a synthetic registered HMAC fixture device. It does not
claim that fixture is the phone's persistent identity. The separate real-P256
unit test proves asymmetric exchange; prior pairing/approval harnesses prove
the persistent phone key independently. Joining these routes is the next gate.

## Verification

-141 combined tests pass: session lifecycle, actual HTTP, durable registry,
  identity/pairing, real cryptography, backend boundary/foundation and cleanup.
- Actual HTTP200 -> storage503 -> recovered200 -> durable device revocation401.
- Actual Simulator identity/sample/read tests pass. The read scenario displays
  stale data, handles outage/recovery and clears visible reading after durable
  device revocation. The token is not directly deleted to produce that401.
- Real P-256 device signature opens a session; registry revocation closes it.
- Tests cover wrong signatures, domain separation from registration, single-use
  and expired challenges, wrong owner, restart invalidation, revocation before
  exchange and failed-attestation token retirement.
- Independent review: eight session and ten real-crypto tests pass; no remaining
  actionable findings in scope.
- Source/history secret scan clean (3461 reviewed occurrences).
- Evidence: `.builds/device-sessions-2026-09-16/` and final
  `.builds/phone-read-check/` UI log/xcresult.

No Swift/UI changes in this slice. Installed Mac build232 and accepted plan's
hash unchanged. All fixture snapshots/device stores remain temporary; private
bootstrap credentials are removed after the Simulator test. No provider,
production account, dependency installation or background service added.

## Reproduce and next step

```sh
python3 -m unittest tests.test_device_read_sessions tests.test_local_today_service -v
python3 scripts/orion_v2_phone_read_check.py
```

Real-crypto tests require the optional device-crypto dependency; verification used
the already available bundled runtime. No package installed globally.

Next: a bounded phone-key session exchange using the persistent identity and a
trusted owner route, then physical/real-account authentication and transport.
Keep developer-token preview separate until that gate is proven.
Rollback: revert the scoped checkpoint; no installed production state changed.
Preserve unrelated capabilities.md and all real device revocation records.
