# Phase 74: Incident Response — Evidence Packet

## Baseline
- **Inspected source paths**: `scripts/orion-incident`, `scripts/orion-mode`, `scripts/orion-lock`, `scripts/orion-automation`
- **Limits**: No installed device access; native Swift checks not registered in local worker. Evidence is source-grounded only.

## Requirement Matrix

| Requirement ID | Status | Source Symbol / Evidence | Notes |
|---|---|---|---|
| provides_procedures_for_the_seven_incident_kinds | Built | `scripts/orion-incident::runbook_all()` — 7 kinds: BACKEND COMPROMISE, DATABASE LEAK, OAUTH CREDENTIAL LEAK, DEVICE THEFT, MALICIOUS DEPENDENCY, PRODUCTION SECRET LEAK, UNAUTHORIZED AUTOMATION. Each has numbered steps or honest "absent" statement for backend and database kinds. | Source-grounded; not yet proven on installed device. |
| provides_the_seven_revocation_mechanisms | Built | `scripts/orion-incident::freeze` — 4 local: (1) remote bridge removal via `orion-remote-install --remove`, (2) automation removal via `orion-automation remove`, (3) strictness to contained via `orion-mode contained`, (4) permission floor via `orion-lock` (manual, printed as prompt). 3 issuer checklists: Google tokens, Discord bot token, Anthropic key — each with exact URL. | Source-grounded; not yet proven on installed device. |
| freeze_is_one_command_because_an_incident_is_when_you_remember_least | Built | `scripts/orion-incident freeze` composes all four local mechanisms in one invocation, ordered loudest-first (remote → automation → strictness → floor). Partial failure leaves the loudest revocations active. | Source-grounded; not yet proven on installed device. |
| thaw_actually_thaws | Built | `scripts/orion-incident::thaw` — passes `--yes` to `orion-mode guarded`, then CHECKS mode via `--json`. If mode is not `guarded`, reports failure and preserves incident record. Deliberately not inverse of freeze: leaves remote access and automations off. | Source-grounded; not yet proven on installed device. |

## Architecture and Interfaces
- **Producer**: `scripts/orion-incident` (bash), delegates to `scripts/orion-mode` (Node.js), `scripts/orion-remote-install`, `scripts/orion-automation`, `scripts/orion-lock`
- **Consumer**: Nick (human operator at terminal). Scripts are NOT on the exec allowlist — they require a person to run them.
- **Serialized fields**: Incident state in `~/.openclaw/orion-controlled/incident.json` (`frozenAt`, `actions[]`). Mode state in `~/.openclaw/orion-gate/strictness.json` (via `orion-mode`). Permission profile in `~/.openclaw/orion-controlled/permission-state.json`.
- **State ownership**: `SessionService` (native Swift) owns durable mode and permission state. Shell scripts modify via CLI interface (`orion-mode`, `orion-lock`). Incident record is local JSON, owned by the script itself.
- **Errors**: Script exit codes (0 success, 1 thaw failure, 64 usage). Printed diagnostics for every step. Thaw verifies post-condition rather than assuming success — the exact anti-pattern this system guards against.

## Smallest Next Slice

No further implementation contract is proposed. All four requirements are Built and source-grounded. The remaining gap is installed-device proof, which requires Nick at the keyboard (remote access must be present to test freeze/thaw cycle). This is a hands-on gate, not an implementation task.

**Blocker for full closure**: Installed device with remote bridge running and automations scheduled. Without it, freeze/thaw cannot be exercised end-to-end. The source is complete; proof requires the live environment.

If Nick wishes to advance this phase, the next step is a reviewer-run native check:
- **Proposed check name**: `incident-freeze-thaw-cycle`
- **Scope**: Execute `orion-incident freeze`, verify incident.json written and all 4 local mechanisms engaged; execute `orion-incident thaw`, verify mode returns to guarded and incident.json removed.
- **Dependencies**: Remote bridge running, at least one automation installed, strictness not already contained.
- **Escalation**: If native check registry does not support bash script execution, this remains a hands-on gate until Nick runs it.

## Test Scenarios

**Nearest existing suite**: None registered for bash scripts in local worker. Native Swift/Python checks not available. These are reviewer-run proposals.

| Scenario | Injectable seam | Expected durable state | Consumer-visible outcome |
|---|---|---|---|
| Positive: freeze on live system | N/A (requires installed device) | `incident.json` written with 4 actions; mode = contained; bridge stopped; automations removed | Terminal output shows each step succeeded; `orion-incident status` confirms frozen state |
| Failure: thaw when not contained | Start in `guarded` mode, no incident.json | No incident.json created; mode remains `guarded` | Thaw prints "no incident freeze in effect" or equivalent; exit 0 with no-op message |
| Failure: thaw after mode change fails | Mock `orion-mode` to return non-guarded mode post-thaw | `incident.json` preserved (not deleted); mode ≠ guarded | Thaw prints "DID NOT THAW" and preserves incident record; exit 1 |
| Partial freeze: bridge removal fails | Kill bridge process before freeze starts, or mock `orion-remote-install --remove` to fail | Steps 2–4 still execute; incident.json records only the actions that succeeded | Terminal shows "COULD NOT remove the bridge" for step 1; remaining steps proceed |

## Gates and Handoff

**Entry gate**: Phase 73 complete (per manifest `entryRequiresPhase: "73"`). Current state: `entrySatisfied: false` — recorded as deviation per AGENTS.md because phases 65/66 are open on the app bundle's designated requirement, deliberately parked until Nick is at keyboard.

**Remaining hands-on proof**:
1. Installed device with remote bridge running and automations scheduled.
2. Execute `orion-incident freeze` → verify all 4 local mechanisms engage, incident.json written.
3. Execute `orion-incident thaw` → verify mode returns to guarded, incident.json removed, remote/automation remain off.
4. Verify partial freeze safety: if step 1 fails, steps 2–4 still execute and system is more restricted, not less.

**Rollback**: After thaw, Nick manually re-enables remote bridge (`orion-remote-install`), automations (`orion-automation install <name>`), and raises permission profile (`orion-permissions`). Thaw deliberately does not auto-re-enable these.

**Reviewer handoff**:
- Verify all cited symbols exist at worktree baseline: `scripts/orion-incident`, `scripts/orion-mode`, `scripts/orion-lock`, `scripts/orion-automation`, `scripts/orion-remote-install`.
- Confirm no authority expansion: proposed check is read-only verification of existing behavior; no new permissions, secrets, or remote access.
- Confirm requirement IDs match brief exactly and status reflects source-grounded evidence only (Built, not Proven).
