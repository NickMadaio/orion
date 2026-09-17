# Remembered local connection — 2026-09-17

The explicit connection review now offers Remember this connection, off by
default. After an approved successful read, the phone stores display metadata:
schema, loopback port, fixture account/device identifiers and the phone's public
key fingerprint. It stores no setup grant, read token, private key or plan.

Control displays these details after relaunch while the phone remains disconnected.
A changed phone key or malformed record is not presented as a verified remembered
connection. Forget removes the saved record, cancels outstanding connection work
and clears the live reading. Cancellation cannot later restore the saved record.

## Evidence and scope

Source/history secret scan clean (3641 reviewed occurrences). Temporary setup
files and the opted-in test record were confirmed removed.

All 15 Swift tests pass. The Swift tests exercise exact serialized fields, round trip, malformed records
and fingerprint mismatch. The Simulator review test opts in, connects, disconnects,
relaunches normally without a reading, observes remembered details, forgets and
relaunches again to confirm removal.

The cancellation test also opts in before cancelling a delayed exchange and
confirms no saved record exists. Both scenarios retain fallback-refusal and
durable-revocation checks.

Independent source review found no actionable issues. Generic physical-iOS
compilation passes unsigned; this is not physical-device verification.

This is connection history only. It does not authorize a request, bypass review
or provide durable enrollment. A fresh setup grant is still required; real-account
and physical-device transport remain unfinished. No new hands-on step is needed.
Formal roadmap remains 45/85 (53%). No installed Mac change or personal-plan write.

Evidence: `.builds/phone-remember-2026-09-17/`, plus UI xcresults under
`.builds/phone-pairing-check/`. Rollback by reverting the scoped checkpoint.
Use Forget connection to remove an opted-in record; do not delete device keys.
