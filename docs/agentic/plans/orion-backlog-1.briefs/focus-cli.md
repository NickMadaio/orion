# Task focus-cli — `orion-session` starts sequences and recovers sessions

Depends on focus-sequence. The Mac app does not yet support the new op; Claude adds it afterwards. Until then the app answers `unknown command`, which is safe.

## Files
- `scripts/orion-session` (edit).
- `tests/focus-cli.test.mjs` (new).

## Behaviour
1. `orion-session start "task" --sequence "20 work, 5 break, 40 work" [--dry-run]` → parse with `parseSequence`; request `{ op: "start-sequence", requestId, task, phases: toRequestPhases(phases) }`. `--sequence` cannot be combined with `--blocks/--focus/--rest/--minutes/--until` (fail with a clear message, exit 2).
2. `orion-session start "task" --sequence "..." --from-phase N --elapsed M` → apply `remainingFrom` (N is 1-based for humans) before sending.
3. `orion-session recover [--sequence "..."] [--task "..."] [--dry-run]`:
   - With `--sequence`: that text IS what remains (Nick says "I had 20 minutes left, then a five-minute break, then another forty-minute block"); task = `--task` or the last history record's task or "focus".
   - Without: read the LAST line of the history file (`ORION_FOCUS_HISTORY` env overrides `~/.openclaw/orion-controlled/focus-history.jsonl`) and use `recoverFromHistory`. Null → print `Nothing to recover: the last session (<task>) finished normally.` and exit 0 without sending.
   - Print `Recovering "<task>": <describeSequence>` then send the start-sequence request (unless --dry-run).
4. `--dry-run` (both commands) prints the JSON request it would send on one line, prefixed `DRY RUN `, and never opens the socket.
5. Update the usage comment at the top of the file with the three new forms. Keep every existing command working unchanged.

## Tests (titles exactly) — run the CLI as a child process with `--dry-run`, `ORION_FOCUS_HISTORY` pointing at a temp file
- "start --sequence sends a start-sequence request with seconds"
- "start --sequence with --from-phase and --elapsed sends only what remains"
- "sequence cannot be mixed with blocks"
- "recover rebuilds the unfinished part from the last history line"
- "recover with --sequence uses Nick's words"
- "recover says nothing to recover after a completed session"
