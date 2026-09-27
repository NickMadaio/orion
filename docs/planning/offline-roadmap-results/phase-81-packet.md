# Phase 81: Future Location Context — Evidence Packet

## Baseline

| Item | Value |
|------|-------|
| Snapshot commit | 9855d99 (2026-09-26) |
| Inspected paths | `scripts/orion-timezone`, `scripts/orion-privacy` |
| Unavailable at baseline | `scripts/location.json`, `scripts/location-audit.jsonl` — not present in worktree; recorded as unavailable per execution limits |
| Limits | No installed device access; audit trail retention gap is historical claim pending source verification |

## Requirement matrix

| Requirement ID | Status | Source symbol / evidence | Notes |
|----------------|--------|--------------------------|-------|
| `requests_minimal_permission` | Built | `scripts/orion-timezone`: no import of CoreLocation, no `CLLocationManager`, no GPS. Location is a JSON record written by Node.js (`writePolicy()` → `LOCATION`). | No permission requested because none is needed. |
| `prefers_coarse_or_contextual_location` | Built | `scripts/orion-timezone` `DEFAULT_POLICY`: `{ home: "America/New_York", place: "Montvale, New Jersey" }`. City name + IANA zone, not coordinates. `canonicalZone()` rejects fixed offsets and non-Region/City names. | Coarse by design — a city name cannot be sharpened into a street. |
| `never_uses_background_location` | Built | `scripts/orion-timezone`: all commands are CLI-driven (`process.argv[2]`). No daemon, no timer, no background fetch. Changes only via explicit `orion-timezone set`/`expect`. Every change appends to `location-audit.jsonl` via `writePolicy()`. | No location API exists to use in the background. |
| `explains_why_it_is_needed` | Built | `scripts/orion-timezone` header comment: "Three cron jobs are pinned `America/New_York`... the nightly memory rollup at 02:10 New York becomes 07:10 London." Consumer is cron timezone re-homing (`cronJobs()`, `plan()`), quiet hours, morning brief day boundary. `docs/planning/v2/DATA_INVENTORY.json` records purpose under "device and system information". | One consumer: timekeeping. |
| `maintains_retention_limits` | Blocked | `scripts/orion-timezone` `writePolicy()`: appends to `AUDIT` (`location-audit.jsonl`) unconditionally, append-only, no size limit. `scripts/orion-privacy` `PURGEABLE.state`: purges `location.json` but deliberately excludes audit ledgers ("an audit trail you can purge in one command is one an attacker purges in one command"). | Audit integrity vs. retention gap for location data specifically. Deliberate design choice requiring a provider decision on whether to add bounded retention or a separate purge path. |

## Architecture and interfaces

**Producer**: `scripts/orion-timezone` — writes current location value and appends to audit trail.

**Consumer**: Timekeeping subsystem — quiet hours, morning brief day boundary, cron timezone, Phase 78 travel brief.

**Serialized fields** (from brief): `{ home: "<IANA zone>", place: "<city name>", expectedMove?: <object> }`

**State ownership**: `scripts/` Node adapters own durable local state for location. Location is a planning signal, not sensor data.

**Errors**: Unknown/stale location data must never be treated as zero or success. Audit trail is append-only by design; retention gap is acknowledged but deliberate.

## Smallest next slice

### Blocker: Retention limit for location audit trail

The `maintains_retention_limits` requirement is blocked. Source evidence from `scripts/orion-timezone`:

- `writePolicy()` (line ~170) calls `appendFile(AUDIT, ...)` on every policy change — unconditionally, append-only, no rotation.
- `scripts/orion-privacy` `PURGEABLE.state` explicitly excludes audit ledgers from purge: "the AUDIT ledgers are deliberately NOT in this list — an audit trail you can purge in one command is one an attacker purges in one command."

This is a deliberate design choice, not an oversight. Closing the requirement requires a provider decision on whether to:
1. Add a bounded retention policy for `location-audit.jsonl` (e.g., max entries or age-based rotation), or
2. Add a separate `orion-privacy purge location-audit --yes` path, or
3. Accept the current state as intentional and record the deviation formally.

No implementation contract can be proposed without that decision. The reconnaissance is complete: the write path (`writePolicy` → `appendFile(AUDIT)`), the exclusion from purge (`PURGEABLE.state` comment), and the audit integrity rationale are all confirmed in source.

**Blocker**: Provider decision required on retention policy for location audit trail. Not a code gap — a design choice that needs authorization before implementation.

## Test scenarios

### Positive cases
1. **orion-timezone sets location**: Run `node scripts/orion-timezone set Europe/London --place "London, UK"`; expect `~/.openclaw/orion-controlled/location.json` updated with `{ home: "Europe/London", place: "London, UK" }` and one new JSON line appended to `location-audit.jsonl` containing the previous value.
2. **Idempotent set**: Run same command again; expect output `unchanged` and no file modification (verified by `writePolicy()` only called when changes exist in `plan()`).
3. **Consumer reads current location**: Cron jobs read via `cronJobs()` → `openclaw cron list --json`; each job's `tz` field matches `policy.home`.

### Failure cases
1. **Missing location.json**: `readPolicy()` returns `{ ...DEFAULT_POLICY, missing: true }` when file absent — the `missing` flag propagates to status output as "(no record yet; this is the default)". Consumer must check for `missing` flag rather than assuming valid data.
2. **Malformed location.json**: `readPolicy()` throws `"${LOCATION} is unreadable: ..."` on parse failure — never silently falls back to default. Verified by `try/catch` in `readPolicy()`.
3. **Non-canonical zone name**: `canonicalZone("America/Buenos_Aires")` returns error (not canonical here) or translates via `ICU_TO_FOUNDATION` map. Fixed offsets like "EST" rejected with `"${name}" is not a Region/City zone name`.

**Injectable seam**: Delete `~/.openclaw/orion-controlled/location.json` before running `orion-timezone status`; verify output shows `(no record yet; this is the default)` rather than crashing or silently succeeding. Corrupt the JSON to verify `readPolicy()` throws rather than falling back.

**Nearest existing suite**: `scripts/run-location-contract-test.sh` (referenced in `orion-timezone` header comment) compiles Swift `TimeZonePolicy` against the JSON this file emits. Not registered in local worker; reviewer-run proposal.

## Gates and handoff

**Entry gate**: Phase 80 exit evidence must pass. `entryRequiresPhase: 80`, `entrySatisfied: true` per manifest. Phase 80 (Future Call Capability) is in the deferred features track (76–84).

**Remaining hands-on proof**:
- Reviewer-run check: confirm cited symbols (`writePolicy`, `readPolicy`, `canonicalZone`, `PURGEABLE.state`) exist at worktree baseline commit 9855d99.
- Confirm no CoreLocation/CLLocationManager imports in `native/` or `scripts/` (search-based, not file-by-file).
- The `maintains_retention_limits` blocker requires a provider decision before any implementation contract can be authored.

**Rollback**: This packet is documentation only; no source changes were made. Rollback is deletion of this file.

**Reviewer handoff**: Reviewer checks: (1) cited symbols exist at baseline, (2) proposed scopes do not expand authority, (3) requirement matrix rows are filled with real evidence or honest blockers, (4) the blocker for `maintains_retention_limits` is correctly identified as a design choice requiring provider authorization, not a code gap.
