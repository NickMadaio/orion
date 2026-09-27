# Phase 67: Cost Controls — Investigation Packet

## Baseline

| Item | Detail |
|------|--------|
| Snapshot commit | 9855d99 (2026-09-26) |
| Inspected source paths | `scripts/orion-budget` (cost tracking, budget enforcement, per-task ceilings); `plugin/orion-control/src/index.test.ts` (repeat-call guard test "blocks a third identical tool call in one run and resets at run end") |
| Limits | No installed device access; native Swift checks not registered. Evidence from source inspection and existing test suites only. Model counts in brief are dated snapshots, not live facts. |

## Requirement Matrix

| Req ID | Status | Source Symbol / Path | Evidence Summary |
|--------|--------|---------------------|------------------|
| `tracks_tokens_model_calls_tool_calls_duration_and_estimated_cost` | Built | `scripts/orion-budget`: `collect()` reads usage JSONL for tokens/model calls; `tasks()` reads task ledger for tool calls (step count/attempts) and duration (`createdAt`/`completedAt` subtraction); `estimate()` derives cost from rate table (shipped at zero, labelled estimated) | All five fields tracked. Tokens and model calls from gateway usage records; tool calls and duration from task ledger; estimated cost from configurable rate table. Cost is labelled estimated everywhere because gateway records 0 (subscription billing). |
| `establishes_per_task_automation_daily_and_remote_session_budgets` | Built | `scripts/orion-budget`: `DEFAULTS` object defines `daily` (totalTokens, modelCalls), `perTask` (toolCalls, seconds), `automation` (modelCallsPerDay), `remoteSession` (modelCallsPerDay); `--check` enforces all four ceilings via `breaches` array | Four budget dimensions exist and feed `--check`. Per-task tokens are an estimate by time window (`overlapTokens()`), labelled as such. |
| `stops_runaway_agent_loops` | Built | Plugin-level: the plugin refuses a third identical tool call inside one run and resets at run end (tested in `plugin/orion-control/src/index.test.ts`, test "blocks a third identical tool call in one run and resets at run end"). Budget per-task ceilings (`perTask.toolCalls`, `perTask.seconds`) serve as backstop for many-different-calls case. | Plugin repeat guard handles identical-call loops. Budget catches different-call loops that look like progress. Both layers present. |
| `alerts_on_abnormal_spending` | Built | `scripts/orion-budget`: `--check` flag — silent + exit 0 when under ceilings; prints one line per breach + exit 1 when over. Designed for cron integration without becoming noise. | Implemented as exit-code-based alerting. Normal outcome is silence. |
| `uses_smaller_cheaper_models_for_appropriate_work` | Built | `scripts/orion-budget`: `collect()` aggregates calls by model name; output shows per-model call counts. Evidence from real history: Haiku 4.5 for light work, local llama3.2/qwen for focused tasks. Model split is visible in report output. | Measurable via `orion-budget` output showing model distribution. Drift toward expensive models would be visible. |

## Architecture and Interfaces

| Aspect | Detail |
|--------|--------|
| Producer | `scripts/orion-budget` — reads `~/.openclaw/agents/main/sessions/*.jsonl` (gateway usage records) and `~/.openclaw/orion-controlled/task-ledger.jsonl` (task runs with steps/timing) |
| Consumer | cron via `orion-cron-deliver`, manual invocation (`orion-budget --check`), `--json` for programmatic consumers |
| Serialized fields | `tokens` (input/output/cacheRead/cacheWrite/totalTokens from usage), `model_calls` (count of usage entries), `tool_calls` (step count + attempts from ledger), `duration_seconds` (completedAt - createdAt from ledger), `estimated_cost` (derived from rate table, labelled estimated) |
| State ownership | Gateway writes usage JSONL; plugin writes task ledger. Budget script is read-only consumer. Ceilings stored in `~/.openclaw/orion-controlled/budgets.json`. |
| Errors | exit 1 on any breach with one line per breach; exit 0 + silence when under ceiling. Unparseable lines counted and reported, never silently absorbed. |

## Smallest Next Slice

No new implementation is needed for Phase 67 — all five requirements are Built. The remaining work is evidence reconciliation: confirming the repeat-guard test actually exists at the cited path and that `--check` exit codes behave as documented.

**Proposed contract 1**: Verify repeat guard integration

| Field | Value |
|-------|-------|
| Title | Phase 67 verification: confirm repeat-call guard test and budget check exit codes |
| Scope | `plugin/orion-control/src/index.test.ts` (read only, verify test exists); `scripts/orion-budget` (read only, verify `--check` exit code logic) |
| Acceptance criteria | 1. Test "blocks a third identical tool call in one run and resets at run end" exists at `plugin/orion-control/src/index.test.ts`. 2. `orion-budget --check` exits 0 when under ceiling, exits 1 when over. 3. No source changes made. |
| Dependencies | None — read-only verification against committed HEAD. |
| Existing checks | `doc-report` (this packet's own check). |
| Brief-level API signatures | N/A — verification only. |
| Escalation conditions | Test does not exist at cited path; exit code logic is absent or inverted. |

## Test Scenarios

| # | Scenario | Injectable seam | Expected outcome |
|---|----------|----------------|------------------|
| 1 (positive) | `orion-budget --check` with all metrics under ceiling | Normal usage records in `~/.openclaw/agents/main/sessions/*.jsonl`, task ledger entries within per-task limits | Silent output, exit code 0. No breach lines printed. |
| 2 (failure) | `orion-budget --check` with daily token ceiling exceeded | Inject a session JSONL file with `totalTokens` summing above `daily.totalTokens` (5M default) | One breach line printed for the over-budget date, exit code 1. |
| 3 (failure) | `orion-budget --check` with per-task tool call ceiling exceeded | Inject a task ledger entry with `steps.length > 40` (default `perTask.toolCalls`) | One breach line printed naming the taskId, exit code 1. |
| 4 (positive) | Repeat-call guard blocks third identical tool call | Run the test at `plugin/orion-control/src/index.test.ts`: "blocks a third identical tool call in one run and resets at run end" | Third identical call is refused; run state resets at run end. Test passes. |
| 5 (failure) | Corrupt budgets.json falls back to defaults | Replace `~/.openclaw/orion-controlled/budgets.json` with invalid JSON | `orion-budget` prints error to stderr, uses `DEFAULTS` ceilings, continues without crashing. |
| 6 (positive) | Model distribution report shows per-model counts | Normal usage records with multiple model names in `message.model` field | `orion-budget` output lists each model with call count, sorted descending. |

## Gates and Handoff

| Item | Detail |
|------|--------|
| Entry gate | Phase 66 must be closed (per `entryRequiresPhase: "66"`). Current state: `entrySatisfied: false`, recorded as deviation per AGENTS.md because earlier phases reference surfaces that do not exist in source. This does not block Phase 67's own evidence reconciliation. |
| Remaining hands-on proof | 1. Confirm repeat-call guard test exists and passes at `plugin/orion-control/src/index.test.ts`. 2. Confirm `orion-budget --check` exit codes match specification (0 = under, 1 = over). Both are read-only verifications against committed source; no installation or device access needed. |
| User decisions | None pending for Phase 67. Rate table in `budgets.json` ships at zero awaiting Nick's input, but that is a configuration decision, not a gate. |
| Source integration | All five requirements map to existing source. No new files, no new exports, no integration gaps. |
| Rollback | N/A — this phase involves no source changes. The packet itself is documentation-only. |
| Reviewer handoff | Reviewer should verify: (a) every cited symbol/path exists at worktree baseline 9855d99; (b) the repeat-call guard test path is correct (`plugin/orion-control/src/index.test.ts`, not `gate.test.ts`); (c) proposed contract scope is read-only and does not expand authority. |
