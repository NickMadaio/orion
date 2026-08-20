# ORION v2 handoff

Updated: **2026-08-20**  
Branch: `orion-v2/phase-0-inventory`  
Observed HEAD: `1169e5b81f04` (`chore: preserve deferred key migration safety`)  
Program position: **Phase 0 complete; Phase 1 complete; Phase 2 not started**

Read this file before changing any v2 contract or live integration file. The
working tree contains substantial unrelated native and OpenClaw work owned by
Nick/Claude. Preserve it. This v2 work is uncommitted; do not commit or push
unless Nick asks.

## Recovering the 2026-08-19 session

The Codex session that wrote the previous version of this file **kept working for
fifteen minutes after writing it, then ran out of credits mid-verification**
(22:47:09Z, `credits.balance = "0"`). The file therefore listed as "next" a slice
that was already built, tested, installed, and live-proven.

If you ever have to do that reconstruction again, it came from four places:
`~/.codex/sessions/<date>/rollout-*.jsonl` (the auto-review thread carries the
main agent's full tool log), `~/.openclaw/logs/config-audit.jsonl`,
`~/.openclaw/orion-controlled/archive/ledger-*.jsonl.gz`, and file mtimes newer
than the handoff's own timestamp. The general rule is now written down in root
`AGENTS.md` under "Relay protocol" — a handoff's date is when it was written, not
when the work stopped.

## What is complete

**Phase 0** is machine-open and its exit evidence is current:

- the replacement Anthropic key is live and the previous server-side key is
  disabled;
- the exact stale Anthropic Keychain item and invalid, unreferenced `.env.save`
  were removed after verification;
- OpenClaw gateway, Anthropic, and Ollama values use three dedicated login-
  Keychain SecretRefs;
- OpenClaw's live audit resolves all three refs with no plaintext, unresolved,
  shadowed, or legacy findings;
- the legacy gitignored mode-`0600` `.env` remains intentionally because the
  current app and scripts still consume non-OpenClaw provider values from it;
- authority inventory is current at 158 capabilities and both repository and
  history secret scans are clean after the reviewed allowlist.

**Phase 1** has a tested contract foundation and one live-proven integration:

- collision-free `orion.core`, `orion.shared`, `orion.security`, and
  `orion.mac` package boundaries;
- an AST import firewall for Core/Shared/Security, including static and dynamic
  imports;
- strict schema-v1 proposal, decision, and execution-result envelopes;
- matching language-neutral JSON Schemas and a drift test;
- recursively immutable JSON boundary values;
- bounded context, model, policy, authorization-bound tool broker, audit,
  runtime, agent, planning, memory, and authorization-bound job ports;
- a strict, read-only `system_status` compatibility adapter and sanitized
  fixture tests;
- **the TypeScript half**: `src/v2/contracts.ts` and
  `src/v2/system-status-adapter.ts`, a default-`false`
  `enableV2SystemStatusAdapter` config flag, and the single wrapped
  `system_status` route in `src/index.ts`.

No native source, installed app, or Swift file was changed. The locally rebuilt
app bundle (1.2.0, build 119) was never installed; the signing identity is
untouched.

## The fail-open correction — 2026-08-20

The bridge as first written **could refuse a call the legacy route accepts.**
`isSystemStatusContractCandidate` only checks step count and action name, so a
`system_status` call carrying any extra argument reached
`strictSystemStatusArguments`, which threw — before `runLegacy()` ran, with
nothing wrapping the call site. The legacy catalog declares
`requiredArguments: []` (`catalog.ts:2033`) and the validator rejects no unknown
key, so that same call succeeds with the flag off. Output drift had the same
shape: `buildExecution` threw *after* the ledger row was already written.

That broke the plan's own requirement 4 (equivalent visible output flag off and
on) and contradicted `src/index.ts:490` — errors must stay "diagnosable, not
brick the tool with an opaque exception."

**The bridge is now an observer, never a gate.** Every strict check is kept, but
a failure records `contractError` in the non-enumerable evidence, warns through
the host logger, and returns the legacy record untouched. The checks became a
drift detector, which is what they were actually good for. A contract experiment
must never be able to stop Orion from answering a question.

Regression proof: the new host-seam test fails against the pre-fix adapter
(throws out of `runAuthorizedGraph` at `src/index.ts:694`) and passes after.

## Verification snapshot

All of these passed on the current dirty tree on **2026-08-20**:

| Check | Result |
|---|---|
| ORION Control suite | 144/144 (was 142; +2 fail-open cases) |
| ORION Control TypeScript compile | passed with `--noEmit` |
| `openclaw plugins build` + `validate` | metadata regenerated from source; valid |
| Installed plugin vs tested build | `diff -qr` clean; manifest byte-identical |
| Full Python suite | 267/267 |
| Python suite flake | one run out of six failed with a single unnamed failure and did not reproduce in five subsequent runs, including one under concurrent load. The suite contains deliberately timing-sensitive TTS deadline tests, and `PHASE_1_PLAN.md` already warns to run timing-sensitive suites separately. No Python behavior changed in this slice. Worth watching, not worth blocking on. |
| Native SessionDomain/SessionService | 318/318 |
| Phase 0 machine gate | passed and open |
| Authority snapshot | current, 158 capabilities |
| Secret inventory | current, values omitted |
| Working-tree/history secret scan | clean; 8 reviewed findings allowlisted |
| OpenClaw live SecretRef audit | clean; 3 refs resolved, zero findings |
| Installed doctor | all clear; gateway and signed app running; TTS daemon not resident, reported as a warning (pre-existing, also seen 08-19) |
| Live smoke — new build, flag **off** | `orion-6c7fb0773e41c616` |
| Live smoke — flag **on** | `orion-26e75dcb764d3884` |
| Live smoke — rollback, flag **off** | `orion-27f07824fc7291f8` |
| Ledger parity, flag off vs on | structurally identical: same top-level keys, step keys, `verified`/`observed` status, and output field set; no `schema_version`, `proposal_id`, or `contractError` anywhere in the row |
| Host logger during flag-on run | no contract warnings — no drift observed |

The ledger-parity comparison is the evidence the 08-19 session never got to
capture. The bridge is transparent by design, so "the flag was on and it worked"
is on its own indistinguishable from "the bridge silently did not engage"; the
in-process host-seam test is what proves it engages, and the two ledger rows are
what prove engaging costs nothing.

## Architectural decisions that must survive

1. The active product route is Swift Orion -> OpenClaw -> TypeScript ORION
   Control. The Python dataclasses under `orion/core` are executable reference
   validators and fixtures, not a new production process or model hop.
2. The JSON Schemas under `orion/core/schemas` are the language-neutral
   contract for future TypeScript and Swift adapters.
3. Existing OpenClaw provenance, `authorizeTaskGraph`, catalog validation,
   executor restrictions, independent verification, and durable ledgers remain
   authoritative.
4. The live integration is read-only `system_status` only, behind a default-off
   flag. It cannot widen authority or change visible output.
5. **The bridge fails open.** A contract violation is reported, never enforced.
   Anything that wants to *deny* an action belongs in the validator and the
   permission profile, which are the components that already own that authority.
6. Legacy `orion/cloud.py` already owns `import orion.cloud`; do not create an
   `orion/cloud/` package until a reviewed rename/compatibility plan exists.
7. `SessionService` remains the sole focus-session writer.
8. Concrete routing, context-firewall, policy, audit/event, and job behavior
   belong to later manifest phases. Phase 1 defines their boundaries only.

## How Phase 1 was closed, and what that does not mean

Phase 1 is marked complete against the five exit criteria in `PHASE_1_PLAN.md`,
all of which are met and evidenced above.

**It is not complete against the manifest's literal exit gate**, which reads
"Existing desktop ORION must run through ORION Core without meaningful
behavioral regression." Nothing runs through Core. One read-only capability is
envelope-*wrapped* by an observer behind a default-off flag, and the legacy route
still performs every authoritative step. `PHASE_GATES.json` records this
deviation explicitly so Phase 2 entry is a decision someone made, not something
that happened quietly.

Whoever opens Phase 2 should decide first whether to accept that reading or to
widen the bridge until the literal gate is met. The manifest's own rule — "do not
skip implementation phases" — argues for making that call out loud.

## Files owned by this v2 slice

Planning and evidence:

- `planning/v2/ANTHROPIC_ROTATION_EVIDENCE.json`
- `planning/v2/CURRENT_AUTHORITY.json`
- `planning/v2/CURRENT_SECRET_INVENTORY.json`
- `planning/v2/MANIFEST_PHASES.json`
- `planning/v2/MANIFEST_TRACEABILITY.md`
- `planning/v2/PHASE_0_SECRET_MIGRATION.md`
- `planning/v2/PHASE_0_STATUS.md`
- `planning/v2/PHASE_1_PLAN.md`
- `planning/v2/PHASE_1_RUNTIME_DECISION.md`
- `planning/v2/PHASE_GATES.json`
- `planning/v2/HANDOFF.md`

Additive contracts and tests:

- `orion/core/**`, `orion/shared/**`, `orion/security/__init__.py`
- `orion/mac/__init__.py`, `orion/mac/system_status_adapter.py`
- `tests/test_v2_*.py`, the focused `tests/test_phase0_*` updates
- `scripts/orion_v2_secret_inventory.py`

Coordinated shared files (Nick confirmed the integration window):

- `openclaw-plugins/orion-control/src/v2/**`
- `openclaw-plugins/orion-control/src/index.ts` — flag declaration and the single
  wrapped route, plus the `hostWarn` sink
- `openclaw-plugins/orion-control/src/index.test.ts` — two host-seam parity tests
- `openclaw-plugins/orion-control/openclaw.plugin.json` and `package.json` —
  **generated**, never hand-edited; regenerate with
  `openclaw plugins build --entry ./dist/index.js`

## Rollback

Setting the flag false is the whole rollback; there is no state migration. It was
exercised live on 08-20 and left in that state. Deeper undo:

- `.builds/openclaw.json.pre-v2-flag-20260820` — live config before the flag flip
- `.builds/orion-control-installed-pre-failopen-20260820/` — the installed plugin
  as it stood before the fail-open build

Both live in the repo rather than `/private/tmp`, where the 08-19 session left its
only copy. `/private/tmp` does not survive a reboot.

## Current live state

Flag `false`. Gateway healthy on 127.0.0.1:18789 running the 08-20 build.
Orion.app running, signed with the stable identity. Installed plugin matches the
tested build byte for byte.

## Exact next step

Phase 2 is **Build the Model Router** — a centralized `ModelRouter` with abstract
roles (reasoning, fast, vision, local, fallback, embedding), provider adapters,
and centralized retries, timeouts, token/cost accounting, and context
construction.

Before any Phase 2 code:

1. Write `planning/v2/PHASE_2_PLAN.md` deriving every requirement and exit
   condition from the manifest, per the evidence protocol in
   `MANIFEST_TRACEABILITY.md`.
2. Settle the Phase 1 exit-gate reading described above.
3. Confirm ownership of the shared files again — the plugin worktree is shared
   with Claude and stays dirty.

The live router today is OpenClaw's own model configuration plus the
Haiku-as-orchestrator decision recorded in root `HANDOFF.md` (2026-08-16). Phase
2 must not quietly become a second router competing with it.
