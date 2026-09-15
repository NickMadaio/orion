# Durable device registration and revocation — 2026-09-15

Built and proven as a bounded local storage gate under Phases14–15 and
REC-LIVE-FOUNDATION. Overall roadmap remains45/85 marked complete (53%). No
real-account pairing, hosted backend or physical-device release is implied.

## Behavior

`backend/devices/durable.py` implements DurableDeviceRegistry behind the existing
registration, adoption, attestation, device-list and revocation contracts. Every
operation reloads persisted records before checking ownership/trust. Separate
instances serialize with SQLite BEGIN IMMEDIATE; synchronous FULL commits make
successful responses follow durable writes. Public identities, attestation,
capabilities, provenance and revocation timestamps survive restart. Private keys
are never stored in this registry.

Creation is explicit: `DurableDeviceRegistry(path, create=True, verifier=...)`
creates a new database exclusively. Normal construction reopens an established
store and refuses missing/truncated/unknown-schema/corrupt state. It does not
repair permissions or recreate lost revocation history. Directories must be0700
and databases0600, owned by the current OS user, with final symlinks refused.
Each connection closes after use; cached trust is discarded after every
transaction, including failed writes. This is schema1; no migration/reset path
is silently selected. SQLite files are metadata in private storage, not encrypted
account vaults. This local implementation loads the full small device registry
per transaction; it is not a scalable hosted database design.

Pairing confirmation now uses one registry transaction for its offering-device
revocation check and admission. A concurrent revoke either commits first and
prevents admission, or follows a completed admission; it cannot slip between
check and write. If persistence fails after the pairing logic finishes, the
in-memory pairing is cancelled instead of displaying completed. Its nonce stays
spent, and retry requires a new offer.

Pending pairing sessions/challenges remain process-local and are invalid after
restart. Only completed device state persists. Policy directories must be
obtained anew for each decision; already returned snapshots are not live objects.
This gate does not revoke existing bearer sessions or prove any remote action's
policy path. Those remain integration work.

## Verification and review

-121 combined tests pass:18 durable-device tests,51 existing identity/pairing,
  nine real-crypto pairing,43 backend foundation/import-boundary checks.
- Actual Simulator persistent key signed the existing typed claim; real P-256
  verification and two-sided fixture confirmation saved both devices. A fresh
  registry revoked the phone; both an older instance and a separate Python
  process observed revocation. Replay was refused.
- Tests cover owner isolation, duplicate concurrent registration, stale-instance
  updates after revocation, confirmation/revocation ordering, rollback, failed
  persistence, corruption, identity mismatch, schema refusal, private storage,
  explicit initialization, and loss of unfinished pairings on restart.
- Independent review found two defects: constructor recreated deleted/truncated
  databases; failed commit retained a completed pairing label. Both repaired,
  independently verified and covered by regressions. Final independent suite:
  18 tests pass, no remaining actionable findings.
- Source/history secret scan clean (3401 reviewed occurrences); matching
  Simulator bridge files verified absent after cleanup.
- Evidence: `.builds/durable-devices-2026-09-15/tests.log`, `simulator.log`, and
  `.builds/phone-pairing-check/ui.log` / Xcode test result bundle.

The offering key and owner are fixtures. The database is a temporary directory
removed by the harness, with no personal account or token provisioned. The phone
still says no account paired. Existing persistent Simulator key is retained.
No Swift code changed in this slice; its actual pairing UI test was rerun.
Mac installed build232 and personal accepted plan hash remain unchanged:
`a4111fae45135cfc2bd14b48b07f761df286bb63b2de5cdd11c707779ff0a5b1`.

## Reproduce and continue

```sh
python3 -m unittest tests.test_v2_durable_devices tests.test_v2_device_identity -v
python3 scripts/orion_v2_phone_pairing_check.py
```

The Simulator harness needs the optional device-crypto dependency; verification
used the existing bundled Python runtime with cryptography50.0.1. No global
installation performed. Test signing remains Simulator-only, never the installed
Mac identity. Source scan and local checkpoint complete the delivery gate.

Next: deliberate offering-device confirmation UI, then authenticated transport
and session lifecycle tied to fresh durable device status. Retain explicit
physical-device, hosted account/authentication and approval gates.

Rollback: revert the scoped local checkpoint. No production store or service was
installed; temporary database and matching Simulator test files are cleaned on
exit. Never auto-delete a real device registry as a rollback: its tombstones are
security state. Preserve unrelated capabilities.md.
