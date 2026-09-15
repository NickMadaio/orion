# Simulator Today connection

Updated 2026-09-15 01:33 BST. The phone now has a working read-only connection to the local
development service. This is a Simulator proof with synthetic records, not
physical-phone pairing or continuous personal-data sync.

## Implemented

- Shared snapshot decoding checks schema, expected owner, revision, size and the existing TodayPlan validation rules. Empty plans are explicit null values.
- A read-only exporter validates a specified Mac plan and preserves its original generation time. It never modifies the source.
- The Simulator reader uses a bounded ephemeral URLSession, refuses redirects and retains revision evidence after a refused response.
- The screen distinguishes recent/stale data, an unavailable source, missing records and revoked access. It preserves the last reading during a service outage and clears it when access is revoked or a response cannot be verified.
- The reproducible harness installs the actual app, starts the existing SQLite-backed loopback adapter and removes its temporary access file when finished. Physical iOS ignores the development bootstrap.

## Verification

Two actual Simulator UI scenarios pass: the original sample/navigation/relaunch
route and a real HTTP read with stale display, injected storage failure, recovery
and revoked-access clearing. Four Swift contract tests cover age, owner/schema/
plan validation, explicit null and repeated rollback/equivocation. The existing
693 MobileCore checks and iOS library compilation passed before the final explicit
null correction; the final app build compiles that correction for Simulator.
One Python cleanup regression verifies malformed/replaced bootstrap files are
preserved and matching fixture credentials are removed.

The actual saved Mac plan was separately validated through the exporter: revision
8, source fingerprint unchanged. Its personal contents were not sent to the
Simulator. Screenshots come from the synthetic connection test.

Review found that a refused response erased the old revision comparison baseline.
TodayReadHistory now keeps it separately, so repeating the same old or conflicting
response remains refused. Review also caught cleanup robustness when XCTest
replaces its data container; teardown now follows the current container and does
not fail on malformed files.

Redirect refusal and transport size limits are source-reviewed; adversarial
HTTP redirect/oversized-body experiments have not been run. No claim of production
authentication, TLS, physical-device use or deployed backend follows from this proof.

## Work through the code

1. [Phone UI and reader](/Users/nickmadaio/Desktop/ORION/native/OrionMobile/App/OrionMobileApp.swift)
2. [Snapshot and revision history](/Users/nickmadaio/Desktop/ORION/native/OrionMobile/Sources/MobileCore/TodayReadSnapshot.swift)
3. [Read-only exporter](/Users/nickmadaio/Desktop/ORION/native/OrionMobile/Sources/TodayPlanExport/main.swift)
4. [Integration check](/Users/nickmadaio/Desktop/ORION/scripts/orion_v2_phone_read_check.py)

From `/Users/nickmadaio/Desktop/ORION`, run:

```bash
python3 scripts/orion_v2_phone_read_check.py
```

Evidence: `.builds/phone-read-2026-09-15/` and `.builds/phone-read-check/`.
No permanent service was installed. Mac build232 and its accepted plan are
unchanged. Rollback is removal of the Simulator app or reverting this source
checkpoint; no real database or external record was migrated.

Next: normal personal-plan publication and deliberate connection configuration,
then durable device/account identity and remote transport. REC-USABLE-CLIENT and
REC-LIVE-FOUNDATION remain open. Formal roadmap remains53% (45/85 phases marked
complete). This milestone does not measure total product readiness.

![Simulator reading a stale fixture through HTTP](/Users/nickmadaio/Documents/Codex/2026-09-07/af/outputs/orion-phone-local-reading.png)
