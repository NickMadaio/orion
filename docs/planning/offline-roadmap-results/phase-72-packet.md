# Phase 72: Privacy Controls — Implementation Packet

## Baseline

| Item | Value |
|------|-------|
| Snapshot commit | 9855d99 (2026-09-26) |
| Inspected source paths | `scripts/orion-privacy` (primary); Phase 71 inventory sources as cited |
| Limits | No installed-device access; native Swift/Python checks not registered in local worker. Evidence from script inspection and source citation only. |

## Requirement matrix

| Req ID | Status | Source symbol / evidence | Notes |
|--------|--------|--------------------------|-------|
| `offers_all_ten_controls` | Built | `CONTROLS` array (10 entries) in `scripts/orion-privacy`; default branch iterates all ten with name/state/how; four have `act: null` and print URL instead of automating | All ten listed; external ones show where to act rather than being hidden |
| `deletion_is_real` | Built | `forget` handler calls `rmSync(hit, { force: true })`; `purge` handler calls `rmSync(path, { recursive: true, force: true })`; both guarded by `if (!yes) { ... process.exit(0) }`; AUDIT ledgers excluded from `PURGEABLE` map | Real deletion; `--yes` required; audit trail deliberately non-purgeable |
| `privacy_settings_are_not_obscure` | Built | Default branch prints all ten controls with current state; `inspect` command reads `DATA_INVENTORY.json` and prints retention/thirdPartyExposure/modelExposure per entry | Every control visible; inventory cross-referenced |
| `export_omits_credentials` | Built | `export` handler copies only `SESSIONS`, `MEMORY`, `BRAIN`, `CONTROLLED`; writes `README.txt` stating credentials not included; no `.env` or Keychain access in export path | Credentials deliberately excluded from export archive |

## Architecture and interfaces

- **Producer**: `scripts/orion-privacy` (Node.js script) — exposes CLI subcommands via command dispatch: default (list all ten), `inspect`, `forget <term>`, `purge <what>`, `export <dir>`, `remote off`.
- **Consumer**: Nick (terminal user); downstream automation reads audit ledgers or exported archives.
- **Serialized fields**: File-system paths under `~/.openclaw/orion-controlled/`, `~/.openclaw/agents/main/`, `~/.openclaw/workspace/memory/`, `~/Documents/orionBrain/`, `~/Library/Logs/orion/`; audit ledger entries are append-only and deliberately excluded from `PURGEABLE`.
- **State ownership**: File-system stores owned by SessionService; privacy script is a policy executor that reads/writes those paths. No new service boundary introduced.
- **Errors**: `fail()` helper exits with code 2 on misuse; missing `--yes` exits 0 with nothing deleted; unavailable paths logged via `weigh()` returning zero; external controls print URLs, no network calls made.

**Proposed seam**: Between `scripts/orion-privacy` and the file-system stores it manipulates. The script is the policy executor; the stores are passive targets. No new service boundary is introduced.

## Smallest next slice

No new implementation is required: all four requirements are marked `passed` in the brief with live evidence from source inspection. The next slice is **evidence reconciliation** — confirming that cited symbols exist at the worktree baseline and that the script's behavior matches the claims on an installed device.

No proposed contracts: there is no missing code to implement. If a gap were found during reviewer verification, the contract would be bounded to ≤3 write paths within `scripts/orion-privacy`, ≤8 acceptance criteria tied to the specific missing control, dependent on Phase 71 inventory completeness, with escalation if authority change is needed.

*Current assessment*: No implementation contract needed. All controls exist in source.

## Test scenarios

| Scenario | Type | Injectable seam | Expected outcome |
|----------|------|-----------------|------------------|
| `inspect` lists all 5 stores with sizes | Positive | None (dry run) | Output contains 5 store lines, total ~179.9 MB |
| `forget` without `--yes` deletes nothing | Failure | Run `forget <target>` without flag | Exit non-zero or zero with "nothing deleted"; files intact |
| `purge` with `--yes` removes target files | Positive | Provide valid target + `--yes` | Files removed; audit ledger entry appended |
| `export` archive excludes credentials | Positive | Run `export`, inspect archive README | README lists excluded paths; no `.env`, keys, or secrets in tarball |
| External control (Google disconnect) listed but not automated | Positive | Inspect script output for URL | URL present; no curl/fetch call to Google APIs |

## Gates and handoff

- **Entry gate**: Phase 71 satisfied (`entryRequiresPhase: 71`, `entrySatisfied: true`). Entry deviation recorded per AGENTS.md (phases 65/66 parked).
- **Remaining hands-on proof**: Reviewer must run `scripts/orion-privacy` commands on an installed device to confirm destructive actions (`forget`, `purge`) behave as claimed and that `--yes` guard works. Local worker cannot execute native checks or Node.js scripts with file-system side effects.
- **Source integration**: Script already exists at `scripts/orion-privacy`; no merge or new registration needed.
- **Rollback**: None — this phase is documentation/evidence only. If evidence is insufficient, revert packet status to "blocker" and record exact reconnaissance needed.
- **Reviewer handoff**: Verify cited symbols (`CONTROLS`, `PURGEABLE`, `weigh`, `fail`, `forget`/`purge`/`export` handlers) exist at commit 9855d99; confirm script output matches brief claims on a live machine. No automatic gate edits.
