# Brief — auto-install-readback: Verify an exact disabled scheduler job

## Where you start
Neither scope file exists yet: create both with `### FILE`, and do not try to READ them. First exchange: `### READ scripts/lib/orion-automation-schedule.mjs` and `### READ tests/automation-schedule.test.mjs`. Nothing else is needed.

## The function (acceptance 1-2)
    export function verifyDisabledSchedule(expected, observed)
Synchronous (NOT `async`: a Promise is not a boolean), a named export, and no imports at all: no fs, no child_process, no network. It never throws: any malformed or missing input returns false (wrap the body in try/catch). It never mutates either argument.
- `expected` is the output of `automationSchedulePlan` (see the shared notes). The plan has no `cwd` field: the expected cwd is the entry right after the single "--command-cwd" in `expected.schedulerArgs`. If that flag is absent (`indexOf` returns -1, and -1 + 1 would read index 0, "cron"), appears twice, or has no value after it, return false. Do not derive cwd from `commandArgv[0]`: `join()` normalizes that entry while "--command-cwd" keeps repoRoot verbatim.
- `observed` is `{ id, name, timeZone, cron, commandArgv, cwd, enabled, exact, noDeliver }`, camelCase exactly (`timeZone`, not `timezone`).
- True only when: `observed.id` is a non-empty string (no format regex: the real scheduler's id format is unknown); `name`, `timeZone` and `cron` are non-empty strings on `expected` and strictly equal on both sides (without the non-empty check, two missing fields compare equal); `observed.commandArgv` is an array of the same length as `expected.commandArgv` with every entry strictly equal (reject missing, extra or non-string entries; never compare joined strings); `observed.cwd` strictly equals the expected cwd; `enabled === false`, `exact === true` and `noDeliver === true`, strictly (not truthiness). No trimming, lowercasing or path normalization: the criterion says exact. Other keys on `observed` are ignored.

## Tests (acceptance 3-4)
- `expected = automationSchedulePlan(proposal(), "Europe/London", "/fixture/repo with spaces")`, with the proposal factory from tests/automation-schedule.test.mjs lines 8-11 (it needs `conditions: {}` and `riskLimits.maxMessagesPerDay`). The repoRoot is an inert string, never the real repository or `homedir()`.
- The valid observed job is written as LITERALS: `{ id: "job-1", name: "orion-auto-calendar-check", timeZone: "Europe/London", cron: "5 9 * * *", commandArgv: ["/fixture/repo with spaces/scripts/orion-automation-run", "calendar-check"], cwd: "/fixture/repo with spaces", enabled: false, exact: true, noDeliver: true }`. Never `verify(plan, plan)` and never build observed by copying plan fields: that validates an object against itself.
- One test asserts the valid job is accepted (`=== true`); without it, a verifier that always returns false passes every rejection test.
- For each of the nine fields, one case from a fresh copy with exactly that field changed, and one with it deleted, each `=== false`. Useful wrong values: name "calendar-check"; timeZone "UTC" and "europe/london"; cron "6 9 * * *"; cwd "/fixture/repo" and "/fixture/repo with spaces/"; commandArgv missing its last entry, with an extra "--extra", as one joined string, split on spaces, and with a number entry; enabled `true`, "false" and 0; exact and noDeliver `false` and "true".
- Named scenarios the contract lists: paths with spaces; an unexpected active job (`enabled: true`); a missing id (deleted, and ""); shell-like arguments (e.g. `["/bin/sh", "-c", "orion-automation-run calendar-check"]`), rejected without executing anything.
- No filesystem access in these tests. Do not add a test that greps the module's source for "fs" or "spawn": task 2 must add fs to this module.

## Exchange plan
1: the two READs. 2: FILE both files (the module is small), with CHECK. 3-5: fixes, each with CHECK. Self-review, then DONE naming the tests for each criterion.

## For the reviewer (judge the diff against these facts)
1. Named, synchronous `verifyDisabledSchedule`; the module imports nothing.
2. Every field compared strictly; cwd taken from after "--command-cwd" with the -1 guard; booleans strict; no normalization; no id format regex.
3. A true-acceptance test; one-field-at-a-time rejections for all nine fields; observed jobs are literals; the named scenarios are present.
4. Only the two scope files changed; the existing automation suites still pass.
