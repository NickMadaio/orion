# hist-cron-deliver

## Where you start

`scripts/orion-cron-deliver` (214 lines, executable Node script) runs a command, then decides whether to post its output through `ROOT/scripts/orion-discord-alert`. It uses:

- `ROOT = join(homedir(), "Desktop/ORION")`;
- `STATE = join(homedir(), ".openclaw/orion-controlled/cron-delivery.json")`, which keeps only the LAST delivery per label.

After the command runs, it can end on these paths (quoting the code):

1. `if (spoken.length === 0) process.exit(result.code);`
2. `if (match && !match.test(spoken)) process.exit(result.code);`
3. `if (previous.message === message && sinceLast < 6 * 60 * 60 * 1000) { process.exit(result.code); }`
4. `if (sinceLast < minIntervalMinutes * 60 * 1000) { console.error(... held back ...); process.exit(result.code); }`
5. `if (!sent.ok) { console.error(... NOT delivered ...); process.exit(result.code); }`
6. After `writeState(...)`, `console.error(... delivered.)` and `process.exit(result.code)`.

Usage errors (exit 2) happen before the command runs. They are NOT recorded.

## Interface

A new constant: `HISTORY = join(homedir(), ".openclaw/orion-controlled/cron-delivery-history.jsonl")`.

A new helper: `async function recordOutcome(outcome, code)`. It appends one line:

```
{"v":1,"at":<Date.now()>,"label":"<label>","outcome":"<outcome>","exitCode":<code>}
```

It creates the directory with `mkdir(dirname(HISTORY), { recursive: true })` and appends with `appendFile(HISTORY, line, { mode: 0o600 })`. On any error it writes `orion-cron-deliver: could not record history — <message>` to stderr, and never throws.

## Decisions

Call `await recordOutcome(outcome, result.code)` immediately before each exit:

| path | outcome |
|---|---|
| 1 | `silent` |
| 2 | `no_match` |
| 3 | `duplicate` |
| 4 | `held_back` |
| 5 | `delivery_failed` |
| 6 | `delivered` |

- The line never contains the output or the message text.
- Exit codes are unchanged everywhere.
- Every existing line of behaviour stays exactly as it is.
- Import `appendFile` next to the existing `node:fs/promises` imports.

## Tests (`tests/automation-hist-cron-deliver.test.mjs`)

**NEVER run the script without `HOME` set to a temp directory.** `homedir()` follows `$HOME`, so with a temp HOME the alert path becomes `<tmp>/Desktop/ORION/scripts/orion-discord-alert`. The test writes a FAKE alert there. The real one is never reachable.

Setup helper `home(t, alertExit = 0)`:

1. Make a temp dir and `mkdir -p <tmp>/Desktop/ORION/scripts`.
2. Write the fake alert with mode 0o755:
   ```
   #!/bin/sh
   echo "$1" >> "$HOME/alerts.log"
   exit <alertExit>
   ```
3. Return the dir.

Run the script with `spawnSync(process.execPath, [SCRIPT, "--label", "t", ...flags, "--", "/bin/sh", "-c", shellCommand], { env: { ...process.env, HOME: tmp }, encoding: "utf8" })`, where `SCRIPT = join(repoRoot, "scripts/orion-cron-deliver")` and `repoRoot` comes from `import.meta.url` (two levels up from `tests/`).

Read the history from `<tmp>/.openclaw/orion-controlled/cron-delivery-history.jsonl`, one JSON object per line.

1. **"a silent command records silent and keeps its exit code"**
   - Command `exit 4`: status 4, and the last outcome is `silent`.
2. **"output that does not match records no_match"**
   - `--match OFF` with `echo hello`: outcome `no_match`, and `alerts.log` does not exist.
3. **"a delivered message records delivered"**
   - `echo hi; exit 3`: status 3, outcome `delivered`, and `alerts.log` contains `[t] hi`.
4. **"the same message again records duplicate"**
   - Run `echo hi` twice in the same HOME: the second outcome is `duplicate`.
5. **"a different message inside the interval records held_back"**
   - `echo a`, then `echo b`, with the default interval: the second outcome is `held_back`.
6. **"a failing alert records delivery_failed"**
   - `home(t, 1)` with `echo hi`: outcome `delivery_failed`.
7. **"a history line holds only v, at, label, outcome and exitCode"**
   - After test 3's run, the line's keys are exactly those five, and the raw line does not contain `hi`.
8. **"an unwritable history file does not change the exit code"**
   - `mkdir` the history PATH itself as a directory first, then run `echo hi; exit 5`.
   - Status 5, and stderr contains `could not record history`.

## Exchange plan

1. EDIT the script: the import, the constant and the helper.
2. EDIT each exit path.
3. FILE the tests.
4. Fix from the checks.
5. DONE.

## Traps

- `process.exit` does not wait for pending promises. `await recordOutcome(...)` BEFORE each `process.exit`.
- `execFile` throws on a non-zero exit. Use `spawnSync` and read `.status`.
- The dedup key is the whole message, `[t] hi`. Test 4 must use identical output.
- Don't record usage errors: the command never ran.

## For the reviewer

- Check that every one of the six exits has exactly one `await recordOutcome` directly before it.
- Check that no other behaviour changed.
- The tests are safe only because HOME is a temp dir. Reject any test that runs the script without it.
