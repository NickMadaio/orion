# Task 1 — exact disabled read-back

Create a small synchronous, pure export:

`verifyDisabledSchedule(expected, observed) -> boolean`

It must not import filesystem, process, network or scheduler modules and must not
throw on malformed input. Require all of the following exactly:

- observed id is a nonempty string; do not invent a UUID format.
- name, `timeZone` and cron equal the expected plan.
- `commandArgv` is an array with identical length and strict per-index equality.
- cwd equals the value immediately after the single `--command-cwd` in
  `expected.schedulerArgs`; explicitly reject a missing flag/value.
- `enabled === false`, `exact === true`, `noDeliver === true`.

Do not normalize strings, paths or case. Do not use truthiness for booleans. Do
not validate the plan against itself. The valid observed fixture should be
handwritten literals for the existing calendar-check proposal and inert path
`/fixture/repo with spaces`:

- job name `orion-auto-calendar-check`
- Europe/London, `5 9 * * *`
- argv `['/fixture/repo with spaces/scripts/orion-automation-run','calendar-check']`
- cwd `/fixture/repo with spaces`

Tests need one valid `=== true` assertion so an always-false function cannot
pass. Independently alter or delete every field. Include active job, blank and
missing id, shorter/longer/string/malformed argv, a space-split argv, truncated
cwd, and shell-looking argv entries. Shell-like text is data and must simply fail
the exact comparison; nothing is executed. Preserve a fresh baseline per case.

Do not prebuild later installer APIs. Keep the verifier standalone so the next
tasks can extend the module without changing this interface.
