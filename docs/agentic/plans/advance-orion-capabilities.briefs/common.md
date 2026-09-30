# Shared notes — Phase 57 disabled-installer batch

This batch fills the gap between the scheduler preview and the guarded runtime, in source and disposable fixtures only: verify a disabled job (task 1), install one transactionally (2), reconcile a crashed install (3), prove the installer's output runs through the real runtime (4), write the review packet (5). Nothing may touch a real scheduler, enable a job, read calendars or use the production root `~/.openclaw/orion-controlled/automations`. The checks run with Nick's real HOME, so a `homedir()` default reached from a test points at his machine: inject every root.

## Files (all exist at HEAD; READ needs these full paths)
- `scripts/lib/orion-automation-schedule.mjs`: `automationSchedulePlan(proposal, timeZone, repoRoot, now = Date.now())` (line 6). `now` is epoch milliseconds; a Date throws "Invalid current clock" (line 19). Returns `{ readyToInstall: false, nextGate, name: "orion-auto-" + proposal.name, timeZone, cron, commandArgv: [join(repoRoot, "scripts/orion-automation-run"), proposal.name], policy, schedulerArgs }` (lines 27-39). `policy` holds only `action, intent, expiresOn, conditions, permissions, riskLimits, failureBehavior`. The expected cwd is the entry after "--command-cwd" in `schedulerArgs` (repoRoot verbatim).
- `scripts/lib/orion-automation-dispatch.mjs`: `initializeAutomationDispatch(runtimeRoot, record)` (line 50) creates `runtimeRoot/admission/<sha256hex(installationId)>.json` and `runtimeRoot/<sha256hex(installationId)>.dispatch.json`, each with exclusive create (a second call throws EEXIST). The ledger binds a sha256 of the WHOLE record (line 26): the installed file must hold the identical object.
- `scripts/lib/orion-automation-admission.mjs`: `binding()` (line 14) requires name `/^[a-z0-9][a-z0-9-]{1,47}$/`, installationId `/^[a-zA-Z0-9-]{8,80}$/`, expiresOn `YYYY-MM-DD`, riskLimits.maxRunsPerDay 1-1440, permissions.expectsMode contained|guarded|open|sovereign, an object `conditions`, a supported IANA timeZone.
- `scripts/lib/orion-automation-runtime.mjs`: `runInstalledAutomation(name, scheduledAt, { automationRoot, repoRoot, checks, run })` (line 18). All four options default to PRODUCTION (lines 19-20): always pass all four. It reads `automationRoot/installed/<name>.json` (line 25), needs `record.name === name` (the bare name), `action === "agenda_today"`, no `delivery`, a string `installedAt`, and dispatches under `automationRoot/runtime`.
- Patterns: `tests/automation-schedule.test.mjs` lines 8-11 (valid proposal), `tests/automation-runtime.test.mjs` lines 10-40 (injected checks and run), `tests/automation-dispatch.test.mjs` lines 160-180 (real child-process death).

## The installed record (tasks 2-4)
Exactly this object goes to `initializeAutomationDispatch(join(root, "runtime"), record)` and to `root/installed/<proposal.name>.json`:
    { name: proposal.name, installationId, installedAt: new Date(now).toISOString(),
      timeZone, trigger: proposal.trigger, ...plan.policy }
The policy fields sit at the TOP level; nested under `policy` the record is refused everywhere. `randomUUID()` (node:crypto) is a valid installationId.

## Tests
`node:test` and `node:assert/strict`, flat `test()` calls. Each test makes its own root: `const root = await mkdtemp(join(tmpdir(), "orion-install-")); t.after(() => rm(root, { recursive: true, force: true }));`. Never write inside the repository (a checkpoint needs a clean worktree) and never print. Use a fixed clock, `const NOW = Date.parse("2026-09-20T08:00:00Z")`, with `expiresOn: "2026-09-27"`, passed everywhere. Fresh factory functions for fixtures; exact statuses, reasons, argv and call lists. Build observed scheduler jobs from literal values, never by copying the plan.

## Working in this loop
- READ three or four files per exchange at most. The working set holds eight; your scope files always stay, and reads that do not fit are skipped.
- Thinking and reply share one 16,000-token budget. Keep reasoning short; write at most one large file (over about 8 KB) per reply. A reply that runs out produces nothing.
- Change existing files with `### EDIT` (SEARCH/REPLACE); only the changed lines are typed. The implementation and test files are 20-35 KB, and retyping one with `### FILE` costs 7-11 minutes of the task's hour. Use `### FILE` only for a new file.
- To add tests, EDIT: SEARCH for the last lines of the file and repeat them in REPLACE followed by the new tests. Keep every existing export and test.
- Keep code and tests compact: share fixture helpers, drive similar cases from a table, and add roughly 6-8 KB of tests per task.
- File contents must not contain triple backticks, or lines starting "### " plus an upper-case marker word: both cut the file short.
- Checks run automatically after every EDIT or FILE. Four exchanges in a row that write, check or say DONE without progress (a first write of a file this attempt, a check turning green, a fix during a self-review) hand the task to the reviewer.
- Do not READ `AGENTS.md` or `HANDOFF.md`: either would push your code out of view. The rules that apply are here.
