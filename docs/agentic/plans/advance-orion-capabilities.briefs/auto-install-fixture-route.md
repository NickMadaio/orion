# Brief — auto-install-fixture-route: Prove installation output reaches guarded execution

## Where you start
Both scope files are in your working set with tasks 1-3's code and tests: keep all of it. This is mostly a test task. The route is the real `installDisabledAutomation` followed by the real `runInstalledAutomation`, with only the outer boundaries injected. Read `installDisabledAutomation` for its fake-scheduler shape and reuse the helper tasks 2-3 wrote if it fits.

First exchange: `### READ scripts/lib/orion-automation-runtime.mjs` and `### READ tests/automation-dispatch.test.mjs`.

## The route (acceptance 1)
Per test: `root` and `repoRoot` from mkdtemp; install with `installDisabledAutomation({ root, proposal, timeZone: "Europe/London", repoRoot, scheduler: fake, now: NOW })`; then
    runInstalledAutomation("calendar-check", scheduledAt, { automationRoot: root, repoRoot, checks, run })
passing all four options every time. `checks` is `{ readContext: async () => ({ now, effectiveMode, focusActive }), authorize: async () => allowed }`. `run(file, args, options)` records the call, appends a line to `join(root, "effect.txt")`, and returns `{ stdout: "agenda" }`.
Never call `initializeAutomationDispatch` and never write `installed/*.json` yourself: that is what the existing runtime tests do and what this contract forbids. The one allowed edit is the "changed installation" case below, which reads the installer's file and changes one field.

## Time
The trigger `{ kind: "daily", atHour: 9, atMinute: 5 }` in Europe/London is due at 08:05 UTC in September: `const DUE = Date.parse("2026-09-20T08:05:00Z")`. 09:05 UTC is `not_due`. `context.now` must be at or up to five minutes after `scheduledAt`. Install with `NOW = Date.parse("2026-09-20T08:00:00Z")`.

## Cases and their exact results (traced through the modules)
- Due (acceptance 2): `status: "succeeded"`; one `run` call with `file === join(repoRoot, "scripts/orion-agenda")` and `args` deepEqual `["today"]`; one effect line. Repeat at DUE with NEW `checks` and `run` objects (every call re-reads disk): `status: "refused"`, `reason: "duplicate_or_old_trigger"`, no new run.
- Refused before execution (acceptance 3). Each on a fresh install; each asserts `status: "refused"`, the reason, and zero `run` calls:
  - `authorize` returns false: `not_authorized`.
  - `effectiveMode: "open"`: `mode_mismatch`.
  - Expired: proposal `expiresOn: "2026-09-21"`, trigger at `Date.parse("2026-09-22T08:05:00Z")` with the same `now`: `expired`. The installer refuses an already-expired proposal, so expiry must come from time passing.
  - Unknown focus: proposal `conditions: { skipDuringFocus: true }` and `focusActive: null`: `focus_unknown`.
  - Changed installation: read `root/installed/calendar-check.json`, change `intent`, write it back: `invalid_state`.
- Not blindly retried (acceptance 4):
  - Install with `failureBehavior: "retry_once"`; `run` appends the effect then throws: `status: "outcome_unknown"`, one run, one effect line. At the next day's slot (`Date.parse("2026-09-21T08:05:00Z")`, same `now`): `refused`, reason `stopped`, no new run.
  - Process death, following tests/automation-dispatch.test.mjs 160-180: a child process (`execFile(process.execPath, ["--input-type=module", "-e", source, JSON.stringify(args)])`) runs `runInstalledAutomation` with inline `checks` and a `run` that appends the effect and calls `process.exit(73)`. Assert code 73. The next call: `busy_or_unavailable`. Only in the fixture, after the child exited, remove the `.lock` directory under `root/runtime`; the next call: reason `outcome_unknown`, still no new run.
- No real systems (acceptance 5), as positive evidence: the fake scheduler saw only `createDisabled` and `read`; every `run` call used the temporary repoRoot; `checks` were called; `result.delivery.status === "not_requested"`; `root/runtime` has no `messages` entry; root and repoRoot start with `os.tmpdir()` (compare strings; never touch the real paths).

## If a case fails
If the installer's output does not fit the runtime (a nested policy, `plan.name` as the name, an extra field after ledger init, an unreleased lock), fixing the installer is in scope: name the fix in DONE, and change a task 2-3 assertion only if it encoded the defect, and only to an equal or stricter one. Changing the runtime, dispatch or admission modules is not in scope: report the defect instead.

## Exchange plan
1: the two READs. 2: FILE the whole test file with ALL the cases above, table-driven where they share a shape, with CHECK. Rewriting a passing file three times in a row trips the stuck gate, so do not add cases one exchange at a time. 3-5: fix what fails, each with CHECK (a check turning green counts as progress). Self-review, then DONE naming the test for each criterion. The test file will pass 12 KB, so expect one extra self-review exchange.

## Traps
- Omitting any `runInstalledAutomation` option: the defaults are production.
- 09:05Z instead of 08:05Z.
- Reusing one root across cases: the ledger remembers each slot.
- Expecting `status: "failed"` for a refusal before execution: it is `refused`.
- Hand-building the installed record like tests/automation-runtime.test.mjs does.

## For the reviewer (judge the diff against these facts)
- Every `runInstalledAutomation` call passes all four options; the installer is the only source of installed records and ledgers, apart from the one-field tamper case.
- Each refusal asserts its exact reason and zero runs; the repeat uses fresh adapters after the first call.
- The pending case uses a real child exit, and the lock is removed only after it; tasks 1-3 tests unchanged and passing.
