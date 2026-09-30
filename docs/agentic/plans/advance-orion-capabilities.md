# Advance ORION capabilities — agent work backlog

**Owner:** Nick · **Prepared:** 23 September 2026 · **Purpose:** “What am I doing next?”

This is the development work queue for the new local agentic loop. Implement the tasks below, check them, send them through local review, and preserve the result for Astra’s later acceptance. This replaces neither the agent’s operating rules nor ORION’s product manifest.

## Product goal

Advance ORION into a useful local-first personal assistant: grounded Today/Plan and Health, durable personal context, reliable automations, connected phone control, and inspectable actions. Build on the current Swift app, TypeScript plugin and Node/Python host tools. Preserve permission checks and honest evidence; do not create a replacement product or reopen completed slices without a concrete regression.

## Recovered starting point

Source conversation: **Advance Orion capabilities**, task `01a07ecb-4895-7650-af05-b0151065ae9b`. Its product work stopped at Phase 57 scheduler registration before the agentic-runtime handoff.

Already implemented in that sequence: grounded brief and Health fixes; Today source recovery; a phone Simulator with persistent device identity and authenticated read-session/connection flows; installed file copying; automation admission, dispatch, delivery budgets, host checks, installed-policy executor, and scheduler preview. These are historical slice results, not claims that the entire phone, automation or remote-control product is finished.

Verified current continuation points:

- `scripts/lib/orion-automation-schedule.mjs` builds a preview and explicitly does not install.
- `scripts/lib/orion-automation-runtime.mjs` reads existing installation policy and durable ledgers; it does not create them.
- `scripts/orion-automation-run` is the guarded tick entry point.
- `HANDOFF.md` identifies transactional registration, a verified disabled job, and later live activation/proof as next.
- `docs/planning/v2/PHASE_GATES.json` still reports 46 complete, 25 in progress and 14 not started. Some narrative reasons are older than subsequent implementation; verify them before using them as new work.

Read `AGENTS.md`, the relevant root `HANDOFF.md` section, and `docs/planning/v2/PHASE_57_SCHEDULE_2026-09-21.md` before the first task. Do not use the old agent foundation handoff as proof that today’s worker/reviewer adapters are absent.

## How this Markdown becomes work

The `orion-plan` block names the batch. Each `orion-task` block is an executable subtask with its own goal, allowed paths, acceptance criteria, checks and dependencies. Prose headings explain the phases to Nick; only those marked blocks enter the queue. Put all requirements needed for execution inside the task contract—not solely in surrounding prose.

The loader is deterministic: it never lets a model infer extra write authority from a broad goal. Large documents are not pasted into every model turn. The worker receives its current contract and relevant files; the host retains the dependency graph and durable progress.

Validate or initialize directly from this file:

```sh
scripts/orion-agent plan docs/agentic/plans/advance-orion-capabilities.md
scripts/orion-agent init docs/agentic/plans/advance-orion-capabilities.md
```

`plan` is read-only. `init` refuses an existing run. Starting execution is a separate `run --until ISO_TIME` or `run --until-stopped` action under the existing enablement gate. Editing this file after initialization does not silently replace an active contract. Live backlog import/hot-reload is not implemented by this loader; finish or safely stop/reconcile the current run before preparing a new one.

This first executable batch is **source-only Phase 57 continuation**, with four implementation/integration tasks and a review packet. It intentionally stops before real schedule creation/enablement and before unrelated capability phases. The agent should continue automatically between queued tasks, use the existing reviewer repair/recovery paths, and notify through the configured webhook when those paths call for it.

```orion-plan
{"project":"Advance ORION capabilities — Phase 57 installer batch","options":{"maxAttempts":3,"maxCorrectionDepth":2}}
```

## Phase A — Verify and register a disabled installation

**Goal:** close the gap between the scheduler preview and durable runtime policy/ledgers without introducing live scheduling effects during development.

### 1. Verify an exact disabled scheduler job

Implement pure scheduler read-back validation for the existing schedule preview and exercise it in disposable tests.

```orion-task
{
  "risk": "medium",
  "reviewDepth": "deep",
  "checks": [
    "node-syntax",
    "automation-install-tests",
    "automation-tests"
  ],
  "nonScope": [
    "Do not call the real scheduler, install or enable a real routine, send messages, read personal calendars, or change installed policy.",
    "Do not change authority maps, agent runtime, task contracts, unrelated code, or phase completion records."
  ],
  "constraints": [
    "Source implementation and disposable fixtures only. Use existing admission, dispatch, schedule preview and installed-runtime modules; no replacement backend.",
    "Tests must use explicit temporary roots and injected fake scheduler adapters. No production paths or external commands with side effects.",
    "Keep existing regression assertions; add coverage without loosening checks. Fixed argv only; no arbitrary shell."
  ],
  "escalateWhen": [
    "A required change lies outside the task scope.",
    "Installed scheduler behavior or schema cannot be established from supplied evidence; document the missing adapter instead of guessing.",
    "An existing invariant must change or a live permission, integration or destructive action is required."
  ],
  "id": "auto-install-readback",
  "title": "Verify an exact disabled scheduler job",
  "objective": "Implement pure scheduler read-back validation for the existing schedule preview and exercise it in disposable tests.",
  "scope": [
    "scripts/lib/orion-automation-install.mjs",
    "tests/automation-install.test.mjs"
  ],
  "acceptance": [
    "Export verifyDisabledSchedule(expected, observed), returning a boolean without filesystem or network effects; expected is automationSchedulePlan output and observed is the normalized adapter object {id,name,timeZone,cron,commandArgv,cwd,enabled,exact,noDeliver}.",
    "Require a nonempty job id, exact expected name/timezone/cron/argv, cwd equal to the --command-cwd value in schedulerArgs, enabled === false, exact === true, and noDeliver === true. Reject missing, malformed, or additional command argv entries.",
    "Tests independently alter each field and cover paths with spaces, valid acceptance, unexpected active job, missing id and shell-like arguments. Do not validate an object against itself.",
    "No scheduler process is spawned and the existing automation suites still pass."
  ],
  "context": "Read scripts/lib/orion-automation-schedule.mjs, orion-automation-dispatch.mjs, orion-automation-admission.mjs, orion-automation-runtime.mjs and tests/automation-schedule.test.mjs. This continues Phase 57 from Advance Orion capabilities; do not rebuild already completed guards.",
  "weight": 2,
  "dependencies": []
}
```

### 2. Create a durable disabled installation transaction

Add an injected-host installation transaction that publishes compatible policy and ledgers only after verifying the disabled scheduler job.

```orion-task
{
  "risk": "medium",
  "reviewDepth": "deep",
  "checks": [
    "node-syntax",
    "automation-install-tests",
    "automation-tests"
  ],
  "nonScope": [
    "Do not call the real scheduler, install or enable a real routine, send messages, read personal calendars, or change installed policy.",
    "Do not change authority maps, agent runtime, task contracts, unrelated code, or phase completion records."
  ],
  "constraints": [
    "Source implementation and disposable fixtures only. Use existing admission, dispatch, schedule preview and installed-runtime modules; no replacement backend.",
    "Tests must use explicit temporary roots and injected fake scheduler adapters. No production paths or external commands with side effects.",
    "Keep existing regression assertions; add coverage without loosening checks. Fixed argv only; no arbitrary shell."
  ],
  "escalateWhen": [
    "A required change lies outside the task scope.",
    "Installed scheduler behavior or schema cannot be established from supplied evidence; document the missing adapter instead of guessing.",
    "An existing invariant must change or a live permission, integration or destructive action is required."
  ],
  "id": "auto-install-transaction",
  "title": "Create a durable disabled installation transaction",
  "objective": "Add an injected-host installation transaction that publishes compatible policy and ledgers only after verifying the disabled scheduler job.",
  "scope": [
    "scripts/lib/orion-automation-install.mjs",
    "tests/automation-install.test.mjs"
  ],
  "acceptance": [
    "Export installDisabledAutomation({root,proposal,timeZone,repoRoot,scheduler,now}); all roots and scheduler adapters are required, with no implicit production defaults. scheduler exposes createDisabled(plan), read(id), remove(id). This function never enables a job.",
    "Use automationSchedulePlan, a new random installationId, installation-bound timezone/installedAt, and initializeAutomationDispatch at root/runtime. Publish the installed record at root/installed/<name>.json in the shape consumed by runInstalledAutomation.",
    "Persist an exclusive per-name transaction intent before any scheduler effect; prevent overwrite of existing installation, ledger, or uncertain transaction. Record returned scheduler id before proceeding to verifyDisabledSchedule.",
    "Return verified disabled state only after durable policy/ledger publication and exact read-back. Errors preserve enough durable status to distinguish no effect, known disabled job, and unknown scheduler outcome.",
    "Tests show successful disabled registration, same-name concurrency refusal, unchanged existing record, failure before create, failed read-back, and failure during publication. Existing policy checks are never replaced with unconditional authorization."
  ],
  "context": "Read scripts/lib/orion-automation-schedule.mjs, orion-automation-dispatch.mjs, orion-automation-admission.mjs, orion-automation-runtime.mjs and tests/automation-schedule.test.mjs. This continues Phase 57 from Advance Orion capabilities; do not rebuild already completed guards. Preserve the verifier interface from the prior task. Read tests/automation-runtime.test.mjs for the actual installed record and dispatch-ledger format.",
  "weight": 3,
  "dependencies": [
    "auto-install-readback"
  ]
}
```

## Phase B — Survive interruptions and prove the whole fixture route

**Goal:** prevent duplicate creation/execution and distinguish uncertain effects from safe retries.

### 3. Reconcile incomplete installation without duplicate effects

Add a conservative reconciliation entry point for incomplete disabled installation transactions.

```orion-task
{
  "risk": "medium",
  "reviewDepth": "deep",
  "checks": [
    "node-syntax",
    "automation-install-tests",
    "automation-tests"
  ],
  "nonScope": [
    "Do not call the real scheduler, install or enable a real routine, send messages, read personal calendars, or change installed policy.",
    "Do not change authority maps, agent runtime, task contracts, unrelated code, or phase completion records."
  ],
  "constraints": [
    "Source implementation and disposable fixtures only. Use existing admission, dispatch, schedule preview and installed-runtime modules; no replacement backend.",
    "Tests must use explicit temporary roots and injected fake scheduler adapters. No production paths or external commands with side effects.",
    "Keep existing regression assertions; add coverage without loosening checks. Fixed argv only; no arbitrary shell."
  ],
  "escalateWhen": [
    "A required change lies outside the task scope.",
    "Installed scheduler behavior or schema cannot be established from supplied evidence; document the missing adapter instead of guessing.",
    "An existing invariant must change or a live permission, integration or destructive action is required."
  ],
  "id": "auto-install-reconcile",
  "title": "Reconcile incomplete installation without duplicate effects",
  "objective": "Add a conservative reconciliation entry point for incomplete disabled installation transactions.",
  "scope": [
    "scripts/lib/orion-automation-install.mjs",
    "tests/automation-install.test.mjs"
  ],
  "acceptance": [
    "Export reconcileDisabledAutomation({root,name,scheduler}); never create or enable jobs while reconciling, never reset consumed quotas, and never guess that a live lock owner is dead.",
    "Completed records are inspected idempotently. An uncertain create with no durable returned job id remains blocked for human inspection; never create a replacement merely because the id is missing.",
    "Known disabled jobs may be inspected or removed only when exact transaction identity and read-back match. Mismatched or unexpectedly enabled jobs are reported for intervention without changing unrelated jobs.",
    "Persist failed cleanup/unknown outcomes accurately. No success claim unless the expected state has been read back. Preserve evidence across another reconciliation attempt.",
    "Tests include an actual child-process exit at a transaction seam, re-opened durable state, repeated reconciliation, scheduler read failure, mismatched id/content, and cleanup failure."
  ],
  "context": "Read scripts/lib/orion-automation-schedule.mjs, orion-automation-dispatch.mjs, orion-automation-admission.mjs, orion-automation-runtime.mjs and tests/automation-schedule.test.mjs. This continues Phase 57 from Advance Orion capabilities; do not rebuild already completed guards. Build on the transaction evidence just implemented; stay inside its existing authority, never add automatic enabling.",
  "weight": 3,
  "dependencies": [
    "auto-install-transaction"
  ]
}
```

### 4. Prove installation output reaches guarded execution

Connect the installer output to the existing runInstalledAutomation path in a disposable end-to-end fixture.

```orion-task
{
  "risk": "medium",
  "reviewDepth": "deep",
  "checks": [
    "node-syntax",
    "automation-install-tests",
    "automation-tests"
  ],
  "nonScope": [
    "Do not call the real scheduler, install or enable a real routine, send messages, read personal calendars, or change installed policy.",
    "Do not change authority maps, agent runtime, task contracts, unrelated code, or phase completion records."
  ],
  "constraints": [
    "Source implementation and disposable fixtures only. Use existing admission, dispatch, schedule preview and installed-runtime modules; no replacement backend.",
    "Tests must use explicit temporary roots and injected fake scheduler adapters. No production paths or external commands with side effects.",
    "Keep existing regression assertions; add coverage without loosening checks. Fixed argv only; no arbitrary shell."
  ],
  "escalateWhen": [
    "A required change lies outside the task scope.",
    "Installed scheduler behavior or schema cannot be established from supplied evidence; document the missing adapter instead of guessing.",
    "An existing invariant must change or a live permission, integration or destructive action is required."
  ],
  "id": "auto-install-fixture-route",
  "title": "Prove installation output reaches guarded execution",
  "objective": "Connect the installer output to the existing runInstalledAutomation path in a disposable end-to-end fixture.",
  "scope": [
    "tests/automation-install.test.mjs",
    "scripts/lib/orion-automation-install.mjs"
  ],
  "acceptance": [
    "Use a fake disabled scheduler, temporary root, real installation transaction, real durable ledgers, and runInstalledAutomation with injected host checks/executor. Do not hand-author replacement installed records to bypass the installer.",
    "A due trigger produces exactly one disposable execution, and a repeated trigger is refused after reopening the runtime state.",
    "Revoked authority, expired policy, incompatible mode, unknown focus when suppression applies, and changed installation each refuse before the execution adapter runs.",
    "A launched executor that performs a disposable effect then fails is not blindly retried; a pending/unknown outcome does not become ready by restarting.",
    "Fixtures prove no real scheduler, calendar, webhook, production root or installed policy was used. Fix installer interoperability defects within scope; report out-of-scope runtime defects rather than modifying them."
  ],
  "context": "Read scripts/lib/orion-automation-schedule.mjs, orion-automation-dispatch.mjs, orion-automation-admission.mjs, orion-automation-runtime.mjs and tests/automation-schedule.test.mjs. This continues Phase 57 from Advance Orion capabilities; do not rebuild already completed guards. This is normal-module integration proof with injected external boundaries, not evidence that real scheduler registration or activation works.",
  "weight": 3,
  "dependencies": [
    "auto-install-reconcile"
  ]
}
```

## Phase C — Hand the result to Astra

**Goal:** make independent acceptance inexpensive. Local review is provisional; passing this batch does not mark the product phase complete.

### 5. Write the implementation review and live-proof handoff

Produce a factual review packet for Astra to evaluate the installer batch and plan real scheduler integration.

```orion-task
{
  "risk": "medium",
  "reviewDepth": "deep",
  "checks": [
    "node-syntax",
    "automation-install-tests",
    "automation-tests"
  ],
  "nonScope": [
    "Do not call the real scheduler, install or enable a real routine, send messages, read personal calendars, or change installed policy.",
    "Do not change authority maps, agent runtime, task contracts, unrelated code, or phase completion records."
  ],
  "constraints": [
    "Source implementation and disposable fixtures only. Use existing admission, dispatch, schedule preview and installed-runtime modules; no replacement backend.",
    "Tests must use explicit temporary roots and injected fake scheduler adapters. No production paths or external commands with side effects.",
    "Keep existing regression assertions; add coverage without loosening checks. Fixed argv only; no arbitrary shell."
  ],
  "escalateWhen": [
    "A required change lies outside the task scope.",
    "Installed scheduler behavior or schema cannot be established from supplied evidence; document the missing adapter instead of guessing.",
    "An existing invariant must change or a live permission, integration or destructive action is required."
  ],
  "id": "auto-install-review-packet",
  "title": "Write the implementation review and live-proof handoff",
  "objective": "Produce a factual review packet for Astra to evaluate the installer batch and plan real scheduler integration.",
  "scope": [
    "docs/planning/v2/PHASE_57_LOCAL_AGENT_REVIEW.md"
  ],
  "acceptance": [
    "Document public APIs, transaction states, side-effect ordering, durable paths, rollback/reconciliation behavior and invariants actually implemented.",
    "Map every task acceptance criterion to concrete tests or explicit unproven status; distinguish observed check output from inferred behavior.",
    "Identify the remaining real scheduler adapter, explicit human activation, exact installed read-back, remote controls, and disposable live-route proof. Do not say any of these happened in the fixture.",
    "List changed paths and limitations relevant to Astra review, including crash windows and unknown outcomes. Do not mark Phase 57 complete, edit the manifest or claim installation/deployment.",
    "State the next bounded source task and the specific live proof required; do not start that work inside this documentation task."
  ],
  "context": "Read scripts/lib/orion-automation-schedule.mjs, orion-automation-dispatch.mjs, orion-automation-admission.mjs, orion-automation-runtime.mjs and tests/automation-schedule.test.mjs. This continues Phase 57 from Advance Orion capabilities; do not rebuild already completed guards. Review the prior four task diffs and test evidence. Do not fabricate commit identifiers if they are not supplied by the host.",
  "weight": 1,
  "dependencies": [
    "auto-install-fixture-route"
  ]
}
```

## Next batch after Astra review — real scheduler integration

These are planned follow-ons, **not executable task blocks in this batch**. Astra must turn each into a bounded contract against the resulting source and installed scheduler interface.

1. Implement the exact installed scheduler adapter: supported argv only, parse current read-back format, create disabled, verify exact identity and fields, refuse unknown schema.
2. Connect the human installer CLI to the transaction. Preserve preview and remove behavior; publish no ready claim before durable ledgers and read-back.
3. Separate activation from creation. Recheck policy, expiry, authority and exact job identity at activation; prove the enabled result and preserve unknown outcomes honestly.
4. Exercise a disposable complete route through the installed scheduler, then stop/remove it and verify absence. No real calendar messages or broad standing routines as a test substitute.
5. Review code, failure injection, process-death behavior, actual scheduler evidence, UI/operator visibility and rollback before closing any relevant Phase 57 criteria.

## Remaining capability roadmap from the prior work

This is a planning inventory, not an executable grant. Rows preserve the current gate file’s reported status; older wording must be reconciled with the newer Today/Health/phone work above. Respect formal manifest dependencies. Do not jump to a later feature just because this table lists it.

| Manifest phase | Capability | Recorded state |
|---|---|---|
| 40 | Travel and Timezone Support | in progress |
| 43 | LOCK ORION | in progress |
| 44 | Mac Remote Connection Foundation | in progress |
| 46 | Harmless Mac Actions | in progress |
| 47 | File Capabilities | in progress |
| 48 | Mac Privilege Separation | not started |
| 49 | Remote Approval System | in progress |
| 50 | Delegated Policies | in progress |
| 51 | Structured Terminal Operations | in progress |
| 52 | Raw Terminal Access | in progress |
| 53 | Automation Sessions for Complex Computer Work | not started |
| 56 | Remote Session UI | not started |
| 57 | Automation Framework | in progress |
| 58 | Automation Simulation | in progress |
| 59 | Proactive ORION | not started |
| 60 | Focus Sessions | in progress |
| 61 | Prep Cards | not started |
| 62 | Waiting-On Tracking | not started |
| 63 | Explainability | in progress |
| 64 | Confidence Handling | in progress |
| 65 | App Intents and System Integration | not started |
| 66 | Live Activities | not started |
| 67 | Cost Controls | in progress |
| 68 | Reliability Testing | not started |
| 69 | Security Attack Testing | in progress |
| 70 | CI/CD Security | in progress |
| 71 | Data Inventory | in progress |
| 72 | Privacy Controls | in progress |
| 73 | Backups and Recovery | in progress |
| 74 | Incident Response | in progress |
| 75 | Development Workflow | in progress |
| 77 | Future Apple Watch Expansion | not started |
| 78 | Future Travel Assistant | in progress |
| 79 | Future Reservation Capability | not started |
| 80 | Future Call Capability | in progress |
| 81 | Future Location Context | in progress |
| 82 | Public Release Preparation | not started |
| 83 | Multi-User Hardening | not started |
| 84 | Final ORION Mobile Product Shape | not started |

### Goals to turn into subsequent bounded batches

- **Reliable automation (57–58):** complete registration and proof above; then simulation/dry-run UX and delivery integration using existing budgets. Do not assume a delivered notification or no side effect after timeout.
- **Useful phone continuity (44, 49, 56, 84):** build on the actual persistent-key read-session and connection UI; distinguish local Simulator proof from physical-device enrollment, remote transport, approval and cancellation. Avoid rebuilding identity from scratch.
- **Safe file and computer actions (46–53):** expose missing optional tool arguments accurately; review retry semantics; complete disposable Trash/recovery proof through its human gate; design privilege separation before implementation. Do not weaken installed boundaries to make an agent task writable.
- **Calm planning and assistance (59–64):** grow focus, prep cards, waiting-on tracking and explainability from actual data and accepted plans. Keep Today useful; no speculative reminders or invented health conclusions.
- **Reliability/privacy (67–75, 81):** exercise limits, recovery, security and retention using isolated fixtures; distinguish a documented procedure from an exercised one.
- **Platform and future capabilities (65–66, 77–80, 82–84):** defer signing/account setup, financial commitments, third-party approvals, call handling, reservations and public/multi-user release until their concrete product and authority gates are defined.

## What Astra reviews when this batch finishes

- The final diff and task/review/repair receipts, not just the model’s summary.
- Actual checks, whether they test the requirement independently, and whether any existing assertions were weakened.
- Scope and behavioral regressions; failure windows around scheduler effects and disk publication.
- Whether the implementation genuinely connects to existing runtime formats.
- Evidence for each acceptance criterion, with fixture versus live limitations stated explicitly.
- Whether the next batch is safe and specific enough to queue. Astra may request correction tasks; local PASS is not production deployment approval.

## Progress rules

The authoritative task state is the host’s durable run state, not manually checked boxes in this document. “Accepted” means passed the local review gate; “Astra accepted” and “installed/proven” are separate milestones. Never rewrite a phase to complete merely because this batch’s tests passed. If one task is blocked, eligible independent tasks may proceed; never skip a dependency or silently expand scope.
