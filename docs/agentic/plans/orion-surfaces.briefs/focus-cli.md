# Task focus-cli — `orion-focus`, the tools ORION calls

## Why
ORION needs allowlisted tools for every focus scenario, including Nick answering back ("I'm on task, I'm reading docs for the lab"). State lives in one JSON file so the brain, the app and the watcher agree.

## Files
- `scripts/orion-focus` (new, executable Node script with `#!/usr/bin/env node`).
- `scripts/lib/focus/state.mjs` (new): `readState(file)`, `writeState(file, state)` (atomic: write a temp file then rename), `stateFile(env)` → `env.ORION_FOCUS_STATE ?? join(homedir(), ".openclaw/orion-controlled/focus-state.json")`.
- `tests/surfaces-focus-cli.test.mjs` (new).

## State file shape
`{ "ladder": <escalation state from focus-escalation>, "allow": [{ "match": string, "until": number|null, "date": "YYYY-MM-DD" }], "log": [{ "at": ISO string, "event": string, "detail": string }] }` — the log keeps the last 500 entries. A missing or unreadable file reads as the empty state.

## Commands (print one short human line; `--json` prints the object instead)
- `orion-focus status` — the state's ladder, allows for today, and the last 5 log lines.
- `orion-focus snooze <minutes> --why "<text>"` — minutes 1..120 else exit 2. Sets `ladder.snoozeUntil = nowMinute + minutes`; logs `snooze`.
- `orion-focus allow "<app or site>" [--block | --today]` — default `--block`: until the current focus block ends (the caller passes `--until HH:MM`; without it, until end of day). Logs `allow`.
- `orion-focus wrong --why "<text>"` — Nick says ORION misjudged: log `wrong`, reset the ladder (`offSince: null, lastStep: "none"`), snooze 15 minutes.
- `orion-focus act <step> [--app "<name>"]` — perform a Mac step: nudge (no-op here, logged; the app shows it), say (logged), front `--app` (`open -a <app>`), quit `--app` (`osascript -e 'tell application "<app>" to quit'`), lock (`pmset displaysleepnow`). Each logs `act`. When `ORION_FOCUS_DRY=1`, print the command it would run (argv joined by spaces) instead of running it. App names must match /^[A-Za-z0-9 .&-]{1,40}$/ else exit 2 (no quoting tricks reach osascript).
- `orion-focus log [--limit N]` — the last N log lines (default 20).
- Clock: real time, except `--now HH:MM` overrides the minute (tests).
- Unknown command → usage on stderr, exit 2.

## Tests — `tests/surfaces-focus-cli.test.mjs` (titles exactly)
Run the script with `spawnSync(process.execPath, [script, ...])`, env `ORION_FOCUS_STATE` in a temp dir and `ORION_FOCUS_DRY=1`.
- "status on a fresh state says nothing is set"
- "snooze sets snoozeUntil and logs it"
- "snooze outside 1..120 exits 2"
- "allow is recorded for today"
- "wrong resets the ladder and snoozes 15 minutes"
- "act quit in dry mode prints the osascript command"
- "an app name with quotes is refused"
- "the log keeps at most 500 entries"
- "a corrupt state file reads as empty"
