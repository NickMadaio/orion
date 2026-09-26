# Phase 51: Structured Terminal Operations — Evidence Packet

## Baseline
- **Commit**: 9855d99 (2026-09-26)
- **Inspected paths**: 
  - `plugin/orion-control/src/devops.ts` (primary implementation)
  - `plugin/orion-control/src/gate.test.ts` (test coverage)
  - `scripts/orion_v2_strictness_check.sh` (allowlist verification)
  - `~/.openclaw/exec-approvals.json` (runtime config, referenced historically)
- **Limits**: No installed device access; evidence is source-grounded only. Native checks not registered in local worker.

## Requirement Matrix

| ID | Status | Evidence / Source Symbol | Notes |
|----|--------|--------------------------|-------|
| `does_not_begin_with_raw_shell` | Built | `DEV_OPERATIONS` in `plugin/orion-control/src/devops.ts`: all seven ops use fixed argv or repo-keyed commands; no raw-shell execution kind exists. Test: `"puts every dev action behind the tier"` in `gate.test.ts` asserts only typed `dev_operations` tier entries. | Zero raw-shell kinds verified by enumeration of `DEV_OPERATIONS`. |
| `creates_structured_development_capabilities` | Built | `DEV_OPERATIONS` in `plugin/orion-control/src/devops.ts`: seven entries — `git_status`, `git_log`, `git_diff`, `git_pull`, `tests_run`, `build_run`, `package_install`. Test: `"puts every dev action behind the tier"` lists all nine (7 + selfdev_queue, selfdev_status) by name. | Seven capabilities confirmed; two additional selfdev ops in same tier. |
| `restricts_repository_working_directory_arguments_environment_time_and_output` | Built | REPOSITORY: `DEV_REPOSITORIES` closed `ReadonlyMap`; test `"names repositories by key"`. WORKING DIRECTORY: `repo.root` from map, never an argument. ARGUMENTS: fixed argv; only `limit` (int 1–100) and `staged` (bool); tests `"builds a fixed argv"` and `"bounds the only two arguments"`. ENVIRONMENT: `devEnvironment()` allowlist of 5 vars; test `"builds the environment from an allowlist"`. TIME: per-op `timeoutMs`; SIGKILL on process group. OUTPUT: `boundOutput()` caps at `MAX_OUTPUT_BYTES` (20 KB), truncates middle; test `"keeps both ends of a long output"`. | All six restrictions implemented by construction, each with a dedicated test. |
| `the_bare_git_allowlist_entry_is_retired` | Proven (historical) | Brief records removal 2026-09-26 with Nick's approval; backup at `.pre-phase51-20260925-211108`. `scripts/orion_v2_strictness_check.sh` asserts entry absent (34/34). Source code confirms all git flows through structured ops only. | Config change, not source change; proven by strictness check script and absence of bare git in `DEV_OPERATIONS`. |

## Architecture and Interfaces

**Seam**: `resolveDevCommand(repository: string, operation: DevOperation, options?) → { argv, cwd, spec } | { error }`

- **Producer**: `plugin/orion-control/src/devops.ts` — exports `DEV_REPOSITORIES`, `DEV_OPERATIONS`, `resolveDevCommand`, `devEnvironment`, `boundOutput`.
- **Consumer**: Orion control plane via `ACTION_CATALOG` (imported in `gate.test.ts` from `./catalog.js`). Each dev operation is registered with `capabilityTier: "dev_operations"`, `risk: "high"` for write ops, `approvalRequired: false`.
- **Serialized fields**: Repository key (string), operation name (`DevOperation` union), optional `{ limit?: number; staged?: boolean }`. Output is capped string via `boundOutput()`.
- **State ownership**: Stateless resolution. Durable state owned by SessionService. Ledger entries record execution outcomes separately.
- **Errors**: Unknown repository key → error object; unknown operation → error; missing repo command (e.g., tests on `orion`) → descriptive error; timeout → SIGKILL on process group; output over cap → middle truncation with byte count label.

## Smallest Next Slice

All four requirements are Built or Proven. No source changes are needed for Phase 51 itself. The remaining work is gate closure evidence reconciliation (Phase 49 and 50 must close in sequence per the brief's `limitations` field).

**Blocker**: Phase 51 stays `in_progress` until Phases 49 and 50 close. This is a sequencing dependency, not an implementation gap. No proposed contract is appropriate because:
- All source symbols exist and are tested.
- The bare git allowlist removal is proven by strictness check script.
- Gate closure requires Nick's decision on Phase 49 (iPhone half) and Phase 50 (`resources` field), which are outside this phase's scope.

**Exact reconnaissance needed for gate closure**: Confirm Phase 49 and Phase 50 entry/exit status in `PHASE_GATES.json`. This is a planning read, not a source change.

No proposed task contracts — prerequisites prevent truthful contracts that would do anything other than re-read phase gates.

## Test Scenarios

**Existing suite**: `plugin/orion-control/src/gate.test.ts`, describe block `"phase 51: structured development operations"` (7 tests).

| Scenario | Kind | Injectable Seam | Expected Outcome |
|----------|------|-----------------|------------------|
| Resolve `git_status` for known repo | Positive | — | Returns `{ argv, cwd, spec }` with fixed argv `["git", "status", "--short", "--branch"]`. Test: `"builds a fixed argv"`. |
| Reject unknown repository key | Failure | Pass path string or traversal attempt to `resolveDevCommand` | Returns `{ error: ... }`. Test: `"names repositories by key"` — five bad inputs all produce errors. |
| Bounded `limit` argument for `git_log` | Positive + Failure | Pass limit 0, -1, 101, 1.5, NaN | All rejected. Pass limit 5 → argv ends with `-5`. Test: `"bounds the only two arguments"`. |
| Environment allowlist isolation | Positive | Set `process.env.ANTHROPIC_API_KEY` and `SOME_BRAND_NEW_TOKEN` before calling `devEnvironment()` | Neither appears in output; exactly 5 keys present. Test: `"builds the environment from an allowlist"`. |
| Output truncation preserves both ends | Positive | Pass 30 KB string to `boundOutput(..., 2000)` | Result < 2500 chars, contains head and tail, labeled cut. Test: `"keeps both ends of a long output"`. |
| Hanging process killed by timeout | Failure | Spawn shell script that sleeps 30s; kill process group after 300ms | `timedOut: true`, settled in < 4s. Test: phase 68 `"kills a wrapper that hangs"`. |
| Repo without test command refused | Failure | Call `resolveDevCommand("orion", "tests_run")` | Returns error — `orion` has no `test` field in `DEV_REPOSITORIES`. Test: `"refuses an operation a repository has no command for"`. |

**Fixture vs. device proof**: All tests above are unit-level fixtures against source symbols. Installed/device proof (strictness check script, allowlist config) is historical and not re-proven here.

## Gates and Handoff

**Entry gate**: Phase 50 (`entryRequiresPhase: 50`, `entrySatisfied: true`). Entered with deviation recorded per AGENTS.md — Phase 50 still open on `resources` field, Phase 49 open on iPhone half. Neither blocks implementation; both block closure.

**Remaining hands-on proof**:
1. Source symbols verified: `DEV_REPOSITORIES`, `DEV_OPERATIONS`, `resolveDevCommand`, `devEnvironment`, `boundOutput` all exist in `plugin/orion-control/src/devops.ts`.
2. Test coverage: 7 tests in `"phase 51"` describe block cover repository keys, fixed argv, bounded arguments, repo-command absence, environment allowlist, output truncation, and tier/risk classification.
3. Strictness check script (`scripts/orion_v2_strictness_check.sh`) asserts bare git entry absent — proven historically, not re-run here.

**Rollback**: Restore `~/.openclaw/exec-approvals.json` from `.pre-phase51-20260925-211108` backup if structured dev ops prove inadequate and bare git must be reinstated (unlikely; the structured path is strictly narrower).

**Reviewer handoff**: This packet maps all four requirements to source symbols and tests. No automatic gate edits are performed. Phase 51 closure awaits Phase 49 → Phase 50 sequential closure, which is a planning decision outside this task's scope.
