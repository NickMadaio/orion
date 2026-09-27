# Phase 82: Public Release Preparation

## Baseline
- **Commit**: 9855d99 (2026-09-26)
- **Inspected paths**:
  - `docs/planning/v2/DATA_INVENTORY.json` — data inventory with retention per kind, checked by `scripts/orion_v2_inventory_check.py`
  - `scripts/orion-privacy` — ten privacy controls including deletion (forget/purge/export), Node.js script
  - `scripts/orion-incident` — seven runbooks plus one-command freeze, shell script
  - `scripts/orion-backup` — encrypted backup with secret redaction, referenced by `orion-incident runbook` for device theft and secret rotation procedures
  - `scripts/orion-readiness` — static design assessment of sixteen final success conditions
  - `docs/planning/v2/MANIFEST_PHASES.json` — phase manifest, Phase 82 entryRequiresPhase 81
- **Limits**: No source changes; report only. Native checks not registered locally. No installed device access to re-prove multi-device claims.

## Requirement matrix

| ID | Status | Evidence / Source Symbol | Notes |
|---|---|---|---|
| `documents_retention_deletion_and_incident_response` | Built | RETENTION: `docs/planning/v2/DATA_INVENTORY.json` entries with retention field, enforced by `scripts/orion_v2_inventory_check.py` against live catalog. DELETION: `scripts/orion-privacy` (forget/purge/export/remote off), real file removal with `--yes` guard. INCIDENT RESPONSE: `scripts/orion-incident` (freeze/status/thaw/runbook), seven runbooks plus one-command freeze that disables remote, automation, strictness, then permission floor in deliberate order. | All three exist and are checked by CI (`orion_v2_inventory_check.py` in `.github/workflows/ci.yml:117`). Three of thirteen items; the other ten are code controls in earlier phases. |
| `tests_account_recovery_device_loss_and_secret_rotation` | Not yet proven | ACCOUNT RECOVERY: N/A — no account, no server, no user record (stated in `scripts/orion-privacy` delete-account control). DEVICE LOSS: documented procedure in `scripts/orion-incident runbook` (iCloud Find My, revoke Google, rotate Discord/Anthropic keys, rotate backup passphrase). SECRET ROTATION: documented in `scripts/orion-backup --secrets` and `scripts/orion-incident runbook`. Neither exercised. | Cannot be tested without losing the device or rotating credentials at four issuers. Human exercise required; not something to rehearse casually. |
| `performs_the_external_reviews` | Blocked | Seven external reviews required: penetration testing, architecture review, privacy review, health regulatory review, Google OAuth verification, App Store privacy review, supply-chain review. None performed. By construction they require people who did not build the system. Nearest internal analogue is Phase 75's independent review, itself outstanding. | Requires outside parties. This system cannot perform external reviews on itself — that defeats the purpose. Blocker: no authority to commission or receive these reviews. |
| `no_one_beyond_trusted_development_users_has_it` | Built | One user (Nick), one machine, private GitHub repository, no distribution, no signing for release, no App Store record. Confirmed by `scripts/orion-readiness` condition 1 ("one ORION identity works across devices" — N/A YET because only one device exists). Phase correctly not started because its trigger has not occurred. | Precondition for the whole phase. EntryRequiresPhase 81; entrySatisfied false recorded as deviation per AGENTS.md. |

## Architecture and interfaces
- **Producer**: `scripts/orion-readiness` (Python) — static design assessment of sixteen final success conditions, outputs verdicts with evidence strings.
- **Consumer**: Human reviewer / Nick — reads the readiness report to decide whether public release is warranted. No automated consumer exists; this is a decision gate, not a data pipeline.
- **Seam**: The readiness report's verdict output (MET/PARTLY/NOT MET/N/A YET) feeds human judgment about release timing. The seam between "system says it is ready" and "it is actually safe to release" is the seven external reviews in `performs_the_external_reviews`.
- **Serialized fields**: `scripts/orion-readiness --json` emits `assessmentKind`, `runtimeVerified`, `conditions[]` (each with `condition`, `verdict`, `evidence`), and `counts`. Incident state serialized to `~/.openclaw/orion-controlled/incident.json` (`frozenAt`, `actions[]`).
- **State ownership**: `scripts/orion-incident` writes incident state; `scripts/orion-privacy` reads/writes user data directories. No shared mutable state between readiness assessment and deletion controls — they are independent tools.
- **Errors**: `orion-privacy` refuses destructive operations without `--yes`. `orion-incident freeze` logs failures per step (e.g., "COULD NOT remove the bridge") but continues — a half-run is still the half that mattered. `orion-readiness` does not execute checks; it reports recorded claims, not live availability.

## Smallest next slice
No proposed contracts. The remaining work for Phase 82 is entirely outside this system's authority:

- **Blocker**: `performs_the_external_reviews` requires seven external reviews by people who did not build the system. This system has no authority to commission, receive, or record those reviews. They are a human/organizational decision, not an implementation task.
- **Blocker**: `tests_account_recovery_device_loss_and_secret_rotation` requires exercising device loss and rotating credentials at four issuers (Google, Discord, Anthropic, backup passphrase). These are Nick's decisions, not automated tasks.
- **Reconnaissance needed**: None — the source exists and is documented. The gap is authority and human action, not missing code.

If Phase 82 were to advance, the next slice would be: commission the seven external reviews (human decision), then record their results in `docs/planning/v2/PHASE_GATES.json`. That is a gate edit, not an implementation contract, and falls outside this task's scope.

## Test scenarios
- **Positive cases**:
  - Run `scripts/orion-readiness` — outputs sixteen conditions with verdicts; exit code 0. Evidence: CI runs it in `.github/workflows/ci.yml`.
  - Run `scripts/orion-privacy inspect` — lists data kinds with sizes and retention from `DATA_INVENTORY.json`. No files modified.
  - Run `scripts/orion-incident status` — reports current freeze state, bridge status, strictness mode, profile, scheduled job count. Read-only.
- **Failure cases**:
  - Run `scripts/orion-privacy purge conversations` without `--yes` — prints what would be deleted, exits 0 without modifying anything. The `--yes` guard prevents accidental deletion.
  - Run `scripts/orion-incident freeze` when bridge is already stopped — step 1 reports "already stopped", continues through remaining steps. Partial success is acceptable by design.
  - Stage a capability tier change in `plugin/orion-control/src/catalog.ts` without updating `DATA_INVENTORY.json` — `scripts/orion_v2_inventory_check.py` fails with "the capability surface changed and DATA_INVENTORY.json did not".
- **Injectable seams**:
  - Delete `~/.openclaw/orion-controlled/incident.json` before `orion-incident status` — reports "no incident freeze in effect" rather than crashing.
  - Remove the Keychain item for `orion-backup` passphrase — `scripts/orion-backup` refuses to run, as designed (checked by `scripts/orion_v2_backup_check.sh`).

## Gates and handoff
- **Entry gate**: Phase 81 (entryRequiresPhase: 81). entrySatisfied recorded as false because Phase 80's neighbours are open on an iOS app and independent review, neither of which is code this phase depends on. Recorded as deviation per AGENTS.md.
- **Remaining hands-on proof**: Seven external reviews (penetration testing, architecture review, privacy review, health regulatory review, Google OAuth verification, App Store privacy review, supply-chain review). Device loss exercise. Secret rotation at four issuers. All require human action outside this system.
- **Rollback**: N/A — this is a report only. No source changes were made.
- **Reviewer handoff**: Verify that cited symbols (`scripts/orion_v2_inventory_check.py`, `scripts/orion-privacy`, `scripts/orion-incident`, `scripts/orion-readiness`, `docs/planning/v2/DATA_INVENTORY.json`) exist at worktree baseline 9855d99. Confirm that the requirement statuses match the evidence: two Built, one Not yet proven (human exercise needed), one Blocked (external parties needed).
