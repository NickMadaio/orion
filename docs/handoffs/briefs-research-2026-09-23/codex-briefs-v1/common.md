# Shared implementation brief

This batch extends the existing Phase 57 automation preview with a source-only,
disabled installer. The contract is authoritative. These notes explain the live
interfaces and traps so you can spend turns implementing rather than rediscovering
them.

Use the full repository paths when reading context:

- `scripts/lib/orion-automation-schedule.mjs`
- `scripts/lib/orion-automation-dispatch.mjs`
- `scripts/lib/orion-automation-admission.mjs`
- `scripts/lib/orion-automation-runtime.mjs`
- `tests/automation-schedule.test.mjs`
- `tests/automation-runtime.test.mjs`
- `tests/automation-dispatch.test.mjs`

The production root is `~/.openclaw/orion-controlled/automations`, but every
test in this batch must inject a temporary root, inert repository path, fake
scheduler and fake executor/checks. Never invoke the real scheduler, calendar,
webhook, authority probes, installed policy or production root.

`automationSchedulePlan(proposal, timeZone, repoRoot, now?)` accepts only
`agenda_today` with no delivery. A valid proposal includes `conditions: {}` and
both `riskLimits.maxRunsPerDay` and `riskLimits.maxMessagesPerDay`. Its result
uses the scheduler job name `orion-auto-<proposal.name>`. `plan.policy` does not
contain the proposal name or trigger. `plan.commandArgv[1]` is the bare
automation name used by the runtime. The expected cwd is the literal value
after `--command-cwd` in `plan.schedulerArgs`; it is not a field on the plan and
must not be derived from `commandArgv[0]` because path joining normalizes that
entry while cwd preserves a trailing slash.

The installed record consumed by `runInstalledAutomation` needs the bare name,
`installationId`, parseable `installedAt`, time zone, trigger and the policy
fields. The exact same complete object must be passed to
`initializeAutomationDispatch(root/runtime, record)` and published at
`root/installed/<name>.json`: dispatch binds a digest of the whole record, so
adding or changing a field afterward produces `invalid_state`.

Match existing durability conventions: exclusive `wx` creation, mode `0600`,
fsync the file, fsync its directory; replacements use a unique temporary file,
rename and directory fsync. Directory locks use exclusive mkdir. Never infer a
lock is stale or remove one without positive proof its owner/process has ended.
Missing or corrupt runtime state is not recreated, consumed quota is not
refunded, and unknown outcomes never become ready merely because the process
restarted.

Node tests use `node:test`, strict assertions, temporary directories and injected
adapters. Build valid fixtures from fresh factory functions. Assert exact status,
reason, argv and call counts. Preserve all tests from earlier tasks. Avoid test
titles containing misleading environment-error phrases. A failed behavior test
is an implementation failure; the host only classifies a spawn failure or exit
127 as an unusable environment.

Keep replies economical. The working set holds eight files. Write complete files,
run the three contract checks, review against every criterion, then finish. A
contract or these notes never authorize work outside the task scope.
