# Phone pairing signature interoperability — 2026-09-15

Bounded scope: the persistent Simulator key can sign the existing pairing claim
and the backend can verify it with real asymmetric cryptography. This is a local
proof gate under Phases 14–15 and REC-LIVE-FOUNDATION/REC-USABLE-CLIENT, not a
numbered phase closure or a production account-pairing release.

## Changes and rationale

- `backend/devices/p256.py`: explicitly injected P-256/SHA-256 verifier backed by
  `cryptography`. Canonical padded base64 uncompressed X9.63 public points only;
  DER signatures match Apple's Security API. Wrong keys, message changes, invalid
  points, alternate encodings and oversized inputs refuse verification. This
  format is named `p256-sha256-der-v1`, not JOSE ES256 (which uses raw r||s).
- `pyproject.toml`: optional `device-crypto` extra pins tested cryptography50.0.1.
  No dependency installed globally. Tests used the existing bundled runtime.
  Default DeviceRegistry still refuses; installing the package alone activates
  no authentication or pairing route. Missing optional dependency fails clearly.
- `App/PhoneDeviceIdentity.swift`: extracted existing persistent identity adapter
  from the app view; typed `pairingClaim` signs only the existing MobileCore join
  protocol and exports public point/signature, never the private key. The test
  file bridge and its Control UI compile only for Simulator and require an
  explicit launch argument and button tap. Expired/oversized requests refuse.
- `scripts/orion_v2_phone_pairing_check.py`: builds before issuing the two-minute
  offer, creates a disposable offering key and owner, gets the actual Simulator
  signature through UI, then calls existing registration/claim/confirmation and
  revocation contracts. No listener, read token, personal data or account added.
  Matching temporary request/proof files are removed on exit; unrelated files
  are preserved. Persistent phone key remains in Keychain by design.
- Fixed `DeviceRegistry.adopt`: its duplicate check used a string against a
  dictionary keyed by `(owner, device_id)`. A valid new key could overwrite an
  existing record, including a revoked identity. The owner-scoped tuple check
  preserves the original record and refuses replacement. Both ordinary tests
  and real-crypto regression tests cover this.

The Python contracts are exercised as a local interoperability harness, not
presented as the installed Mac runtime. No provider or hosted service chosen.
No hand-written cryptography or HMAC substitute was introduced. The adapter
uses the library's documented public-key validation and DER verification:
https://cryptography.io/en/latest/hazmat/primitives/asymmetric/ec/

## Proof and limits

- 60 identity/pairing tests pass, including nine tests with real crypto.
- 43 backend foundation/import-boundary checks pass.
- Actual Simulator UI claim and Python verification pass: claim alone does not
  register, fixture Mac confirmation admits, replay refuses, revocation succeeds.
- Three existing Simulator UI scenarios pass after extraction: persistent identity,
  sample/relaunch and read/stale/outage/recovery/revoked-access clearing (46.035s).
- Generic physical iOS build succeeds without signing/install. This is compile
  evidence only; physical Secure Enclave behavior remains unproven.
- Independent source/security review: no actionable findings; reviewer reran
  all60 identity/pairing tests. Reviewer did not run Xcode.
- Source/history secret scan clean (3371 reviewed occurrences). Temporary pairing
  request/response and read-bootstrap files absent after cleanup.
- Logs: `.builds/phone-pairing-check/` and `.builds/pairing-2026-09-15/`.

The offering Mac key and account are fixtures, the registry is in memory, and
fixture confirmation is automatic test orchestration. This does not prove a
human approval UI, real-account authentication, QR delivery, durable revocation,
restart recovery, a deployed backend, or a physical phone connection. App still
says no account paired. No capabilities or permission grants issued.

Mac installed build232 and accepted plan's SHA256 remained unchanged:
`a4111fae45135cfc2bd14b48b07f761df286bb63b2de5cdd11c707779ff0a5b1`.

## Reproduce

Use a Python3.11+ runtime with the `device-crypto` extra available. The system
Python without it can still run existing tests; the real-crypto test module
reports explicit skips, and the Simulator harness fails before any build.

```sh
python3 -m unittest tests.test_v2_device_identity tests.test_v2_p256_pairing -v
python3 scripts/orion_v2_phone_pairing_check.py
python3 scripts/orion_v2_phone_read_check.py
```

The first two commands were run with the pre-existing Codex bundled Python:
`/Users/nickmadaio/.cache/codex-runtimes/codex-primary-runtime/dependencies/python/bin/python3`.
The scripts scope Xcode to an iOS Simulator with ad-hoc signing. Mac app signing
identity and global xcode-select settings are untouched.

## Next and rollback

Next: owner-scoped durable registration/revocation, restart proof, then deliberate
offering-device confirmation UI and authenticated pairing transport. Keep the
phone unpaired until those conditions are true. Overall phase count remains
45/85 marked complete (53%); this local signature gate does not advance it.

Rollback by reverting this scoped checkpoint; no runtime service was installed.
Temporary test files are removed, but the existing persistent Simulator key is
not deleted. Preserve unrelated `capabilities.md`.
