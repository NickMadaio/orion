# hist-runtime-record

## Where you start

`scripts/lib/orion-automation-runtime.mjs` (78 lines) exports `runInstalledAutomation(name, scheduledAt, options)`. It:

1. validates the name;
2. reads `<automationRoot>/installed/<name>.json`;
3. builds adapters;
4. ends with `return dispatchAutomation(join(automationRoot, "runtime"), record, scheduledAt, adapters);`.

It records nothing. hist-ledger created `scripts/lib/orion-automation-history.mjs`, which exports `appendAutomationHistory(file, entry, { now })`. The entry format is in common.md.

## Interface (unchanged)

`runInstalledAutomation`'s signature, options and return value do not change. The only new effect is one appended history line.

## Decisions

1. Replace the final `return dispatchAutomation(...)` with:
   - `const result = await dispatchAutomation(...)`;
   - then `await recordOutcome(...)`;
   - then `return result;`.
2. Skip recording when `result.reason === "not_due"`: that is not a firing.
3. The file is `join(automationRoot, "history", \`${name}.jsonl\`)`.
4. The entry:
   - `at`: `scheduledAt`
   - `name`: `name`
   - `status`: `result.status`
   - `reason`: `typeof result.reason === "string" ? result.reason : null`
   - `delivery`: `typeof result.delivery?.status === "string" ? result.delivery.status : null`
5. Wrap the append in `try { … } catch { }`. A failed or invalid append is swallowed, and `result` is returned unchanged. Never modify `result`.
6. The two early returns BEFORE dispatch are not recorded: `invalid_name` and `installation_unavailable_or_unsupported`.
7. Import only `appendAutomationHistory`. Add no other imports except what is already there.

## Tests (`tests/automation-hist-runtime.test.mjs`)

Copy the `fixture(t, change)` helper from `tests/automation-runtime.test.mjs` into your own test file. Don't import from it, and don't edit it. The helper:

- builds a temp root, writes `installed/runtime-test.json`, and calls `initializeAutomationDispatch(join(root, "runtime"), record)`;
- passes `options = { automationRoot: root, repoRoot: root, checks: {readContext, authorize}, run }`, with fakes that return `{ stdout: "fixture calendar" }`.

`at = Date.parse("2026-09-20T10:00:00Z")`. The record has `trigger: { kind: "hourly", atMinute: 0 }`, `timeZone: "UTC"` and NO `delivery`.

Read the history back with `readAutomationHistory(join(root, "history", "runtime-test.jsonl"))`.

1. **"a succeeded dispatch is recorded once with its delivery status"**
   - One dispatch returns `status === "succeeded"`.
   - There is exactly 1 entry: `at === at`, name `"runtime-test"`, status `"succeeded"`, reason `null`, delivery `"not_requested"`.
2. **"a replay is recorded as refused with its reason"**
   - Dispatch twice at the same `at`.
   - There are 2 entries. The second has status `"refused"`, reason `"duplicate_or_old_trigger"` and delivery `null`.
3. **"a trigger that is not due records nothing"**
   - `runInstalledAutomation("runtime-test", at + 60000, options)` returns reason `"not_due"`.
   - `readAutomationHistory` returns 0 entries.
4. **"an unwritable history location does not change the result"**
   - Before dispatching, `writeFile(join(root, "history"), "not a directory")`.
   - The result still has status `"succeeded"` and output `"fixture calendar"`.
5. **"early refusals are not recorded"**
   - `runInstalledAutomation("../other", at, options)` returns reason `"invalid_name"`.
   - After `rm` of the installed file, dispatch returns status `"refused"`.
   - `join(root, "history")` does not exist in either case.

## Exchange plan

1. EDIT the runtime (the import, then the final return).
2. FILE the tests.
3. Fix from the checks. `automation-tests` must stay green.
4. DONE.

## Traps

- The fixture's `run` fake records launches. Don't assert launch counts here; that is the existing suite's job.
- `readContext` is called twice per successful dispatch. Don't add calls.
- Don't record before dispatch: a crash mid-dispatch must not leave a history line claiming an outcome.
- Test 4's history "directory" is a regular file, so `mkdir` fails. That is the failure injection.

## For the reviewer

- The diff to `orion-automation-runtime.mjs` should be about 10 lines: one import, and the final return split into dispatch, record and return.
- Anything else changed in that file is out of scope.
