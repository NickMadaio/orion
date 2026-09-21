# Phase 57 scheduler entry point and preview — September 21

Completed the scheduler entry point and human-readable schedule preview begun
September20. This checkpoint does not install or activate a schedule. Formal
completion remains46/85 (54%).

## Built

scripts/orion-automation-run accepts exactly one installed automation name. It
passes the current minute to the guarded installed-policy runtime, which checks
the actual trigger, ledgers, authority and conditions. It accepts no timestamps,
policy paths, timezone overrides or executable arguments. Missed minutes are
skipped rather than reconstructed. Scheduler output contains only status and a
bounded reason code, never calendar text, arbitrary adapter fields or stderr.

orion-automation schedule-plan <name> --timezone <IANA> previews the exact derived
cron expression, command argv, expiry, conditions, expected mode and limits.
It requires an explicit supported timezone and the reviewed agenda_today action
without delivery. The plan specifies disabled creation, exact timing and disabled
fallback delivery. It explicitly says readyToInstall:false; installation identity,
durable ledger creation, job verification and activation are still outstanding.

The installed OpenClaw CLI supports --cron, --tz and --command-argv. The legacy
installer used obsolete --schedule/--timezone flags, hardcoded New York time and
ran through a delivery wrapper without the new admission/runtime checks. Removed
that path. install now reports its unavailability and creates nothing. The
existing list/show/simulate/remove routes and existing schedules remain intact.

## Verification

Eight new tests cover daily/hourly/weekly derivation, argv with spaces, prohibited
shell/agent/delivery flags, invalid scope/date/timezone/name, current-minute ticks,
override rejection, safe failure output and an actual entrypoint subprocess.
The real human CLI install refusal was also observed without scheduling anything.

Independent review found that the legacy expiry check used the host timezone.
The preview now validates actual expiry and the180-calendar-day lifetime against
the chosen timezone, with opposite-date Los Angeles/Tokyo regressions. Invalid
clock dates that cannot produce an integer calendar-day difference also refuse.

Final quick source CI passed348 plugin tests and82 automation tests. Independent
review also ran all82 successfully; focused tests were repeated after the invalid
clock hardening. Secret scan is clean with30 reviewed fixtures allowlisted.
Evidence is saved under .builds/phase-57-schedule-2026-09-20/
and .builds/phase-57-schedule-2026-09-21/. The quick run skips the dependency
network audit and does not establish live scheduler execution.

## Next gate and rollback

Implement human-only registration that creates installation identity and durable
state, creates a disabled job, verifies its exact configuration and enables it
only after those steps succeed. Then prove a disposable complete route and
failure recovery. No live schedule or calendar action ran for this checkpoint;
no new hands-on action is needed yet. Revert the scoped local source checkpoint
to roll back. No production scheduler state needs restoration. Preserve the
unrelated capabilities.md. No remote push was performed.
