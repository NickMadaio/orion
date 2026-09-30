# Task 4 — full inert route

Re-read the final installer module and tests first. Keep every earlier assertion.
Use the real `installDisabledAutomation` with a fake disabled scheduler and
temporary root/repo path, then call `runInstalledAutomation(name, scheduledAt,
{automationRoot: root, repoRoot, checks, run})`. Do not hand-author an installed
record or call `initializeAutomationDispatch` from the new route tests; the point
is proving the installer produced what the existing runtime consumes.

Use the bare name from `plan.commandArgv[1]`. Supply all four runtime options on
every call, including child-process fixtures. A due trigger must produce one
disposable execution and `succeeded` with delivery `not_requested`; a fresh
second runtime call for the same slot must return `refused` /
`duplicate_or_old_trigger`, with one launch total.

With a fresh installation per case, prove revoked authority, expiry, mode
mismatch, and unknown focus when suppression applies all refuse before injected
`run` is called. Also mutate the published installation after ledger binding and
prove it refuses (`invalid_state` or the exact existing runtime reason) without
execution. Assert attempts and call count, not just status.

For uncertain effects, use `failureBehavior: retry_once`: an injected executor
that records a disposable effect then throws must launch once and return
`outcome_unknown`; reopening must not rerun it. For process death, let a child
exit inside the injected executor. The durable phase remains pending and its lock
remains. Reopening first reports busy; only after the fixture has positively
observed child exit and removes its own fixture lock may it report
`outcome_unknown`, which must persist across a later slot.

Positive evidence that production was untouched includes temporary roots, fake
call logs, injected checks, inert repo path, no messages ledger and no delivery.
The fixture does not prove the real scheduler/tick uses a production install;
state that limitation rather than broadening scope.
