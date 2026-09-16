# Persistent phone key opens a local read session — 2026-09-16

This gate joins previously separate proofs: the persistent Simulator key that
paired can now obtain a device-bound session, read a plan over HTTP and lose
access after durable revocation. Overall roadmap remains45/85 phases (53%).

## Implementation

`MobileCore/DeviceReadChallenge.swift` defines the exact domain-separated session
message. Validation binds the expected owner, device ID and public key, checks
schema/identifier/nonce formats and canonical point encoding, and refuses
expired or excessively future challenges. The phone compares the supplied key
to the public key derived from its own stored private-key reference. Signing
uses Apple's P-256/SHA256 Security API and checks expiry at signing time.

The signing bridge/control button exists only in Simulator builds and requires
an explicit launch argument. Fixture owner/device association is fixed in this
route. The UI says proof signed/awaiting acceptance, not account signed in.
Private keys never leave the phone. There is no arbitrary-message signing API.

`scripts/orion_phone_session_scenario.py`, selected through the pairing harness's
`--read-session` flag, exchanges the actual phone signature through
DeviceReadSessions. Reusing the proof fails. Its issued token is used by the
actual Swift reader against loopback HTTP. The source emits read, outage,
recovery, then durable device revocation: the next refresh refuses and clears
the visible reading. Revocation survives reopening and a separate Python process
through the enclosing pairing harness.

## Proven and still pending

- Combined `--approval --read-session` Simulator flow passed: enrollment claim,
  explicit approval/rejection/expiry, persistent-key session proof, HTTP reading,
  source outage/recovery, proof replay refusal and durable revocation.
- Final isolated --read-session rerun after cleanup repair passes.
-143 backend checks pass; source/history scan clean (3491 reviewed occurrences).
-13 Swift tests pass, including four new session challenge binding/expiry tests.
- Generic physical-iOS compilation passes unsigned; no physical install/proof.
- Independent review found a cleanup gap when XCTest changes data containers.
  The harness now tracks initial, response and bootstrap directories plus the
  current directory, and cleans all known locations even if final lookup fails.
  Two cleanup regressions pass independently; final review has no actionable
  findings. Unrelated requests/tokens are preserved.
- Evidence under `.builds/phone-key-session-2026-09-16/` and
  `.builds/phone-pairing-check/session-proof.log` / `session-read.log`.

Account enrollment remains disposable. Challenges/proofs/tokens travel through
private Simulator files; there is no account sign-in or session-exchange HTTP
endpoint. The fixture Mac initially confirms phone admission. The separate
approval path proves the phone as an offering device, not real user enrollment.
No hosted provider, production TLS, biometric verification, physical-phone key
behavior or remote-action authorization is implied. Default app remains unpaired.

This closes the specific persistent-key issuance gap in the local harness.
The personal-plan preview still uses the older development token route; it is
not silently promoted to real device authentication. Snapshot contents here
are synthetic, with stale age deliberately preserved.

## Reproduce, next and rollback

```sh
python3 scripts/orion_v2_phone_pairing_check.py --read-session
python3 scripts/orion_v2_phone_pairing_check.py --approval --read-session
```

Use the optional device-crypto runtime; verification used the existing bundled
Python with cryptography50.0.1. No package was installed globally. Run Simulator
UI harnesses sequentially; they share one app/container.

Next: replace the private-file exchange with a bounded authenticated local
transport, preserving signed challenges, trusted owner binding, replay/expiry
and durable device checks. Account sign-in/physical-device deployment remain
separate gates. Installed Mac build232 and personal accepted plan are unchanged.

Rollback the scoped local checkpoint. No service or production store installed;
temporary credentials/stores are removed, persistent Simulator key retained.
Never reset real keys or erase device revocation records as a cleanup step.
Preserve unrelated capabilities.md.
