# Brief — auto-install-review-packet: Write the implementation review and live-proof handoff

## What you can and cannot see
You write one new file, `docs/planning/v2/PHASE_57_LOCAL_AGENT_REVIEW.md`; your working set starts empty. You have no git, no diffs, no commit ids, no review verdicts and no receipts, and the plan file is not in your worktree. What you can use:
- The two batch files as they stand. Both are new since the batch began, so their current contents ARE the combined change of tasks 1-4: `### READ scripts/lib/orion-automation-install.mjs` and `### READ tests/automation-install.test.mjs`.
- `### READ scripts/orion-automation` for the human CLI: its `install` command still refuses ("installation is unavailable until guarded scheduler registration is connected").
- The CHECK output of THIS task. Only the last 6,000 characters of each check are shown, and `node-syntax` passes with "no matching changed files" for a Markdown-only change: that is not evidence about the code.
- The criteria and follow-on list quoted below, from the approved plan.
Say plainly in the document that per-task diffs, review verdicts and commit ids were not available to you. Never invent them, and write no dates you did not observe. Cite function and test names, not line numbers (you see files without them).

## Label every claim
**Observed**: in a passing CHECK output you saw in this task (a named test passing, or an exact summary such as `pass N` / `fail 0`). **Inferred**: read in the source, with no test proving it. **Unproven**: neither. A test counts for a criterion only if its assertions exercise it; a test's name is not evidence. For example, a "child-process exit" test must actually spawn node and exit.

## Recommended structure
1. Scope and evidence basis (what you could and could not see).
2. Public API: every export, its exact signature, its status or phase strings spelled exactly as in the code.
3. Transaction states and the order of side effects: lock, transaction file, create, id persisted, read-back and verify, ledger init, publication, complete. Take this from the code, not from the contract: if the code differs from what the contract asked, say so.
4. Durable paths: `installed/<name>.json`; `runtime/<sha256hex(installationId)>.dispatch.json`; `runtime/admission/<sha256hex(installationId)>.json`; the transaction and lock paths the code uses.
5. Reconciliation: what `reconcileDisabledAutomation` does in each state.
6. Criterion map: each of the 19 criteria below, with the test(s) that exercise it and the label. Task 5's own criteria are met by this document, not by tests.
7. Not done / not proven: all five items from criterion 3 of your contract, each with evidence. The real scheduler adapter does not exist; the only source evidence of the real scheduler's output is the job-list shape in `scripts/lib/orion-automation-removal.mjs` (`jobs` with `id` and `name` only), so mapping real read-back to the normalized job is not established. There is no activation path. The CLI refuses to install. `scripts/orion-remote` has no automation controls. Everything was proven with a fake scheduler and temporary roots only.
8. Limitations for Astra: changed paths (the two batch files and this document, inferred from scope enforcement, not observed from git); crash windows (before create; after create but before the id is durable; after read-back but before or during publication; `initializeAutomationDispatch` writes two files non-atomically; the dispatcher's window between reservation and pending; lock directories left by a crash); unknown outcomes; a leftover transaction blocking a same-name reinstall; the legacy CLI's `remove` knowing nothing of transactions.
9. The next bounded source task (follow-on 1) and the specific live proof required (follow-on 4), quoted. Activation (follow-on 3) is a separate, human-gated step. Write no code and start no follow-on work.
Do not mark Phase 57 complete, edit the manifest or gates, or claim installation or deployment.

## The 19 acceptance criteria of tasks 1-4, verbatim from the approved plan
Task 1, auto-install-readback:
  1.1 Export verifyDisabledSchedule(expected, observed), returning a boolean without filesystem or network effects; expected is automationSchedulePlan output and observed is the normalized adapter object {id,name,timeZone,cron,commandArgv,cwd,enabled,exact,noDeliver}.
  1.2 Require a nonempty job id, exact expected name/timezone/cron/argv, cwd equal to the --command-cwd value in schedulerArgs, enabled === false, exact === true, and noDeliver === true. Reject missing, malformed, or additional command argv entries.
  1.3 Tests independently alter each field and cover paths with spaces, valid acceptance, unexpected active job, missing id and shell-like arguments. Do not validate an object against itself.
  1.4 No scheduler process is spawned and the existing automation suites still pass.
Task 2, auto-install-transaction:
  2.1 Export installDisabledAutomation({root,proposal,timeZone,repoRoot,scheduler,now}); all roots and scheduler adapters are required, with no implicit production defaults. scheduler exposes createDisabled(plan), read(id), remove(id). This function never enables a job.
  2.2 Use automationSchedulePlan, a new random installationId, installation-bound timezone/installedAt, and initializeAutomationDispatch at root/runtime. Publish the installed record at root/installed/<name>.json in the shape consumed by runInstalledAutomation.
  2.3 Persist an exclusive per-name transaction intent before any scheduler effect; prevent overwrite of existing installation, ledger, or uncertain transaction. Record returned scheduler id before proceeding to verifyDisabledSchedule.
  2.4 Return verified disabled state only after durable policy/ledger publication and exact read-back. Errors preserve enough durable status to distinguish no effect, known disabled job, and unknown scheduler outcome.
  2.5 Tests show successful disabled registration, same-name concurrency refusal, unchanged existing record, failure before create, failed read-back, and failure during publication. Existing policy checks are never replaced with unconditional authorization.
Task 3, auto-install-reconcile:
  3.1 Export reconcileDisabledAutomation({root,name,scheduler}); never create or enable jobs while reconciling, never reset consumed quotas, and never guess that a live lock owner is dead.
  3.2 Completed records are inspected idempotently. An uncertain create with no durable returned job id remains blocked for human inspection; never create a replacement merely because the id is missing.
  3.3 Known disabled jobs may be inspected or removed only when exact transaction identity and read-back match. Mismatched or unexpectedly enabled jobs are reported for intervention without changing unrelated jobs.
  3.4 Persist failed cleanup/unknown outcomes accurately. No success claim unless the expected state has been read back. Preserve evidence across another reconciliation attempt.
  3.5 Tests include an actual child-process exit at a transaction seam, re-opened durable state, repeated reconciliation, scheduler read failure, mismatched id/content, and cleanup failure.
Task 4, auto-install-fixture-route:
  4.1 Use a fake disabled scheduler, temporary root, real installation transaction, real durable ledgers, and runInstalledAutomation with injected host checks/executor. Do not hand-author replacement installed records to bypass the installer.
  4.2 A due trigger produces exactly one disposable execution, and a repeated trigger is refused after reopening the runtime state.
  4.3 Revoked authority, expired policy, incompatible mode, unknown focus when suppression applies, and changed installation each refuse before the execution adapter runs.
  4.4 A launched executor that performs a disposable effect then fails is not blindly retried; a pending/unknown outcome does not become ready by restarting.
  4.5 Fixtures prove no real scheduler, calendar, webhook, production root or installed policy was used. Fix installer interoperability defects within scope; report out-of-scope runtime defects rather than modifying them.

## The plan's follow-on list, verbatim
1. Implement the exact installed scheduler adapter: supported argv only, parse current read-back format, create disabled, verify exact identity and fields, refuse unknown schema.
2. Connect the human installer CLI to the transaction. Preserve preview and remove behavior; publish no ready claim before durable ledgers and read-back.
3. Separate activation from creation. Recheck policy, expiry, authority and exact job identity at activation; prove the enabled result and preserve unknown outcomes honestly.
4. Exercise a disposable complete route through the installed scheduler, then stop/remove it and verify absence. No real calendar messages or broad standing routines as a test substitute.
5. Review code, failure injection, process-death behavior, actual scheduler evidence, UI/operator visibility and rollback before closing any relevant Phase 57 criteria.

## Writing the file
- No triple backticks anywhere in the file: the file would be cut off at the first one. Show code and paths inline with single backticks, or as indented blocks.
- No line may start with "### " followed by an upper-case marker word (READ, SEARCH, FILE, CHECK, DONE, BLOCKED, PROPOSE, SUBTASK). Use `##` headings and ordinary words.
- Keep it under about 11,000 characters: a larger write adds a self-review exchange, and the whole file is re-emitted on every write.
- Exchange plan. 1: the three READs. 2: FILE the complete draft, with CHECK. 3: FILE the final version citing the check output you just observed, with CHECK. 4: DONE. A document cannot turn a failing check green, so there is no room for more rewrites than that. If a check fails, it belongs to tasks 1-4: send `### BLOCKED` quoting it, and never edit tests.

## For the reviewer (judge the diff against these facts)
- Every claim is labelled; nothing claims a commit id, diff, verdict or date that the worker could not see; the node-syntax pass is not cited as evidence.
- All 19 criteria are mapped, each to specific tests or to an explicit unproven status.
- All five not-done items are present, with none described as done; Phase 57 is not marked complete.
- Crash windows and unknown outcomes are listed; the next source task and live proof are the plan's follow-ons 1 and 4.
