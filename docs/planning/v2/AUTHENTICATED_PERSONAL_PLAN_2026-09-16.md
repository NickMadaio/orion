# Personal plan over the device-authenticated read route — 2026-09-16

The saved Mac accepted plan now passes through the Simulator's persistent-key
HTTP session route. This completes a bounded personal-publication verification
slice, not real account enrollment. Roadmap remains 45/85 phases (53%).

## What changed

The pairing/read harness accepts an explicit `--source` only with `--http-session`.
Relative paths are resolved in the caller's directory before switching to the
repository. The path is configured on the trusted host and is never accepted
from an HTTP request. No default personal path is selected by the script.

The existing Swift exporter validates the source before the HTTP read grant or
listener is created. PublishingTodayRepository reads that source on each valid
request, with existing owner, schema, revision and stale-data protections. The
source file is never written. A bounded UI verification timeout prevents this
publication check from leaving a permanent service running.

The personal UI scenario reads the plan, refreshes the same revision, captures
its display, then requests again after durable device revocation. The reading
must disappear. A separate failed-exchange test retains the no-legacy-fallback
check. Before/after source hashes must match for the command to report success.
The synthetic outage/recovery route remains available without --source.

An optional `--preview-seconds 1..120` opens the normal Simulator app on the
same authenticated personal route. Its timer starts after a successful read.
Expiry, interruption or failure revokes the fixture device, closes the listener
and removes matching bootstrap files. The persistent Simulator key is retained.

## Proof

- Actual saved plan revision8 was read and refreshed after HTTP challenge,
  persistent-key signing and token issuance. Next refresh after revocation cleared
  the reading. Revocation remained visible after process restart.
- Screenshot visually checked against saved-plan evidence: revision, reason,
  original creation date, task duration and free-time block matched. The plan
  correctly remained labeled stale; fetching it did not make old evidence fresh.
- Source SHA256 unchanged:
  `a4111fae45135cfc2bd14b48b07f761df286bb63b2de5cdd11c707779ff0a5b1`.
- 156 combined backend/publication checks pass. Independent publication review
  reran three tests and found no actionable issues.
- A 15-second authenticated preview passed, including durable revocation and
  unchanged source. Temporary setup/pairing files were confirmed absent afterward.
- Invalid duration and incompatible source/preview arguments reject before build.
- Independent timed-preview source review found no actionable issues.
- Source/history secret scan passed; final result is recorded in the evidence log.
- Evidence: `.builds/personal-auth-read-2026-09-16/`, associated screenshot and
  `.builds/phone-pairing-check/http-session-ui.log` / xcresult.

No phone production source code changed in this slice; the existing authenticated
reader was exercised with actual data. Installed Mac build232 is untouched. No
Calendar/Reminders/source refresh or plan mutation was performed. Temporary
stores and matching setup files are removed; persistent Simulator key is kept.

## Remaining boundaries

The device key is real and persistent, while enrollment/account identity remains
a disposable local fixture. A file still supplies the short-lived host setup
grant. The invocation is explicit and bounded, but it is not a user-facing durable
setup screen, a hosted account, remote TLS, a physical-phone deployment or a
permanent sync service. The old personal-preview command remains separate and
still uses its development-token route.

Next: persistent user-approved enrollment/configuration and physical transport.
The bounded authenticated preview entry is now available. Keep
new authority and account/provider decisions visible rather than inferring them
from successful local proofs.

## Reproduce and rollback

Use a runtime with the existing optional device-crypto dependency:

```sh
python3 scripts/orion_v2_phone_pairing_check.py --http-session --source /absolute/path/to/today-plan.json
```

Verification used the pre-existing bundled Python runtime; no global package
installation occurred. This command enrolls a disposable test device, runs the
UI read/refresh/revoke scenario, and exits. It does not leave a connected account.
For an interactive preview instead of the read/revoke UI assertions, append
`--preview-seconds 120`. This starts a disposable local service and closes it when
the timer ends or you press Ctrl-C. Run Simulator harnesses sequentially.

Rollback by reverting this scoped checkpoint. No installed production state to
restore; never reset real keys or erase revocation records. Preserve unrelated
capabilities.md.
