# Explicit device pairing approval — 2026-09-16

This bounded gate adds a visible approval decision backed by the Simulator's
persistent signing key. It does not authenticate a real account or connect a
physical phone. Overall roadmap remains45/85 phases marked complete (53%).

## What changed

`PairingApprovalRequest` is immutable. The screen and signer use the same
joining public key, device ID, pairing ID and nonce. Validation checks schema,
expected account, offering fingerprint, canonical public-key format, backend
identifier rules and the two-minute expiry window. The platform adapter checks
that the public point is valid P-256 and rechecks expiry at the moment of signing.

`PairingApprovalView` displays the account, exact device ID and full SHA256 key
fingerprint. Fingerprints use eight-character groups for comparison, while the
accessibility label retains the raw64 characters. Approval is disabled until
the comparison switch is selected; both decisions are disabled after a decision.
An expired request cannot produce a confirmation. Signing displays “awaiting
service acceptance”, never a premature paired/success claim. The label clearly
identifies a disposable test account and says identity admission does not approve
messages, purchases or remote actions.

The file bridge, test-account route and offering-key confirmation signer compile
only for Simulator. Normal launch remains unpaired. The shared request and view
compile for physical iOS but are not connected to an authenticated account.
The compare switch records an explicit UI action; automated tests do not prove
that a person compared two real devices. No biometric proof is claimed.

## Actual connected test path

Run `scripts/orion_v2_phone_pairing_check.py --approval` using a Python runtime
with the existing optional device-crypto dependency. The original fixture Mac
flow first admits the phone into a disposable durable registry. The phone then
acts as the offering device for a second joining test key. This exercises both
roles without inventing another phone private key on the backend.

The actual Simulator screen signs confirmation with its persistent key after a
tap. The backend checks that signature against the exact joining key and ID,
rejects a changed ID/replay, and admits only after its normal confirm contract.
Rejection emits no signature; an expired request emits no response. The harness
applies rejection to the service; this is a local file bridge, not authenticated
remote transport. Temporary records and bridge files are cleaned; the existing
Simulator private key intentionally remains in Keychain.

## Review and evidence

- Final isolated Simulator flow passes: persistent-key claim, explicit approval,
  rejection and expired request. Backend verifies the confirmation, rejects
  changed ID/replay and preserves revocation across process restart.
-122 Python checks pass, including durable device, identity, real crypto,
  foundation/import-boundary and approval-cleanup coverage.
-Nine Swift tests pass: five approval validation/binding/time cases and four
  existing Today reading cases.
- Final three existing Simulator identity/sample/read-recovery scenarios pass.
- Source/history secret scan clean (3431 reviewed occurrences).
-Generic physical-iOS build passes unsigned, without install/runtime proof.
-Independent review found two defects: device-ID validation was broader than
  the backend on length/initial character; failed container lookup could bypass
  known-file cleanup. Both fixed and regression-tested. Final review has no
  remaining actionable findings.
-Rendered fingerprint wrapping was corrected to explicit groups after screenshot
  inspection, preserving the raw value for accessibility.
-Evidence: `.builds/approval-2026-09-16/` and
  `.builds/phone-pairing-check/approval-*.log` / associated xcresults.

During resumed verification two Simulator UI runs overlapped and interfered;
both were stopped and cleaned, then rerun sequentially. Those interrupted runs
are not counted as product failures or passing evidence.

## Next and rollback

Next: authenticated local transport and session lifecycle that checks durable
device revocation on every request; then real-account/physical-device pairing.
No provider, paid service, biometric claim or remote-control grant introduced.
The installed Mac app and personal accepted plan are untouched.

Rollback the scoped local checkpoint. No production store/service was installed.
Do not reset the phone's persistent key or delete real revocation records as a
rollback step. Preserve unrelated capabilities.md.
