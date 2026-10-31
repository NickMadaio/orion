# The exact gate: test ORION the way the Mac app talks to him

The 2026-10-15 sweep called `openclaw agent --json` with a fixed context and no thinking flag, so it looked
better than real use. This driver sends the same bytes the app does.

## What is reproduced

| App code | Port | Checked how |
|---|---|---|
| `AppState.agentRequest` (app-context block, spoken suffix) | `lib/request.mjs` | template read out of `AppState.swift` and compared line by line (the function is private to a UI class, so it cannot be compiled into a harness) |
| continuation prefix (`"(Continuing — …)"`) | `lib/request.mjs` | string pinned against `AppState.swift` |
| `GatewayClient.recentOutreach` / `OutreachTracker` / `OutreachContext` | `lib/outreach.mjs` | goldens from the real Swift |
| `SchedulingMemory.context` (+ `LocalRoutingMode`) | `lib/scheduling.mjs` | goldens from the real Swift |
| `ThinkingPolicy.level` / `struggled` | `lib/thinking.mjs` | goldens from the real Swift |
| `GatewayClient.ask` argv, env, session key shape | `lib/gateway.mjs` | argv order pinned against `GatewayClient.swift` |
| `extractReply`, `stripANSI` (what the app shows) | `lib/reply.mjs` | read from the source; not golden-tested |
| clock and resume phrases never reach ORION | `lib/shortcuts.mjs` | read from the source |

`prefix.mjs` re-exports all of it. Every function is pure; the clock, session status, outreach rows,
SCHEDULING.md text and routing mode are injected.

**Session state is real.** The app-context block comes from `orion-session status --json` at the moment of
the turn, never a fixed string. The one thing it cannot see is the enforcer's *allowed apps* list (the status
wire does not carry it); it says "none established" unless you pass `--allowed-apps "A,B"`.

### Parity check

```bash
native/Orion/Tests/run-gate-parity-test.sh            # real Swift -> scripts/eval/gate/fixtures/parity-goldens.json
node --test scripts/eval/gate/test/parity.test.mjs     # the port against those goldens
GATE_PARITY_LIVE=1 node --test scripts/eval/gate/test/parity.test.mjs   # also Nick's real SCHEDULING.md under the live routing config
```

The harness (`native/Orion/Tests/GateParityHarness/main.swift`) compiles the real `ThinkingPolicy`, `ChatThinking`,
`OutreachContext`, `SchedulingMemory` and `LocalRoutingMode` sources with plain `swiftc`. 47 fixtures: 15 thinking,
13 scheduling (digest, fail-open, 12k cap, 2100 cap, unavailable), 13 outreach (multi-turn tracker sequences,
reply-to, bedtime precedence, windows), 6 struggled. A mutation of the digest limit fails the suite.
**Scope:** the goldens fix the inputs listed in `parity-inputs.json`. They say nothing about inputs outside it,
and `agentRequest`/`extractReply` are pinned to source text, not executed. Regenerate the goldens after any
change to those Swift files; the test fails loudly if the golden names are stale.

## ask.mjs: one message

```bash
node scripts/eval/gate/ask.mjs --text "whats on today" --json
node scripts/eval/gate/ask.mjs --text "move gym to 6" --spoken --conversation <id> --reply-to <outreachId> --json
node scripts/eval/gate/ask.mjs --text "..." --dry-run --json       # build the exact message, send nothing
```

Output: `{ reply, latencyMs, model, routing, tools, raw, sessionKey, thinking, message, status, error, inbound }`.
`message` is the exact `--message` the CLI received. `routing` is every local-routing log line for the run id,
plus a merged `summary` (decision, flow, `provided`, `reads`, `cloud`, `model`, `turnMs`). `tools` come from the
session transcript. Flags: `--continuation` (second half of a cut-off sentence), `--model`, `--no-shortcuts`.
The session key is `orion-chat-gate-<stamp>-<n>` (or `orion-chat-<--conversation>`); a conversation id
containing "eval" or "test" is refused, because the plugin treats such keys as internal and skips local routing.

`--inbound auto|on|off` controls `orion-inbound-turn`, which the app runs on every turn (logs the turn, closes a
curiosity ask, injects the outreach being answered into the session). Default `auto`: only when `--reply-to` is
given. It is off otherwise because it appends to `inbound-turns.jsonl`, which the awareness layer reads as
"Nick is active"; a gate run is not Nick. Use `on` to be exact; the runner restores that file.

## run.mjs: a scenario bank

```bash
scripts/eval/gate/launch.sh scenarios.json [--readonly] [--only id,id] [--start N]    # under launchd, follows the log
scripts/eval/gate/launch.sh --stop <label>          # SIGTERM: finish and undo the current item, then stop
scripts/eval/gate/launch.sh --recover <out dir>     # restore from a run that was killed mid-item
node scripts/eval/gate/run.mjs scenarios.json --dry-run [--tier …]   # print every item's setup: no marker, no writes, no gateway
```

Schema (validated up front; a bad file runs nothing):
`[{ id, area, wording: "vague"|"clear", pair, writes: bool, setup: { now?, state?, calendar?, live? }, turns: [{ text, spoken?, replyToOutreach? }], expect: { rubric, reply_must?: [regex], reply_must_not?: [regex], effect?: { kind, detail } } }]`

- Concurrency 1. Turns of one item share one conversation (`gate-<stamp>-<item number>`); the outreach tracker and
  thinking boosts persist across items the way the app's process-wide ones do (a sandboxed item gets its own tracker).
- `--readonly` skips `writes: true` items (recorded as skipped). `--tier sandbox|live|all` (default all) picks items by tier.
- Every item's result carries `setup.applied` and `setup.unmet`: what was really true for it, and what was not and why.

### Item setup: the sandbox tier and the live tier (`lib/setup.mjs`)

- **`setup.calendar`** `{ now, events: [{ title, start, end, owned? }], reminders?: [{ title, due? }] }` puts the item
  in the evaluation sandbox: `eval-calendar.json` (with its `now`) and a copy of `life-config.json` as
  `eval-life-config.json` are written beside the marker for that item only. While both exist, `lib/life/bridge-path.mjs`
  sends every calendar read and write to `lib/eval/sandbox-bridge.mjs` and uses the sandbox's `now`; the plugin's
  `pluginNow()` (`src/plugin-clock.ts`, only while the calendar file is under 2 h old) and `undoJournalTop` see the same
  pair; the app-side clock in the message (outreach window and "N min ago", thinking boost, QuickAnswer) is set to it too.
  `owned: <kind>` marks an ORION-owned block (`orion: <kind>` in the sandbox), anything else is fixed.
  At undo every sandbox file (`SANDBOX_FILES`: the calendar, its undo journal, pins, skips, written, inbound...) is
  removed FIRST, before `orion-reschedule undo` runs, so that undo can only reach his real journal. The snapshot
  covers them, `verify` checks they are gone, and `--recover` removes them after a crash. An item refuses to start
  while any sandbox file already exists (another evaluation, or an unrecovered crash); a sandboxed item is skipped
  under `--eval-mode off`, because without the marker its writes would reach his real calendar.
  `effect.sandboxCalendar` records what the item did to the sandbox day (created, deleted, moved, to-dos).
- The calendar fixtures are generated by `tools/gen-setup.mjs` from a table written by hand from each item's notes
  (`--check` fails if the files drift from it). The WEEK: MKTG2201 Mon 13:30-15:30, ECON1115 Tue 11:00-12:30,
  CS2100 Wed 09:00-10:30 (the scenario README gives no end time: 90 min assumed), Gym 17:00-18:30 and Side project
  19:30-20:30 every day, Monday of `now`'s week through the next Monday.
- **`setup.state`** writes JSON into named restorable state files (undone afterwards). The abstract keys map to the files
  ORION reads: `sleep_last_night_h` / `whoop_recovery` -> `health-log.json` `days[<date of now>]` (code-answers' sleep
  reply); `gym_done_days_last7` -> `health-log.json` `workouts[]` and `logged.jsonl` rows (day-questions'
  "gym days this week"); `timezone` is met when the host clock shows the same wall time; `home` is met when it is the
  live home place (never changed for a test); `llm: down` is always unmet (only stopping Ollama would make it true).
  The effect diff starts AFTER the setup, so a fixture is never counted as the item's effect.
- **`setup.live: true`** (about 20 clear write items): no sandbox, the real calendar at the real time. Times that are
  premises are tokens in the turn text, rendered against the real clock when the turn is sent: `{{now}}`,
  `{{now+30m}}`, `{{now-90m}}`, `{{now+2h}}`, `{{today 17:00}}`, `{{tomorrow 09:00}}` -> "7:15pm". The result keeps
  the rendered `text` and the `template`. Run this tier in the afternoon or early evening: "+150m tonight" past
  about 21:30 crosses midnight.
- Items with neither (memory, screen, files, keychain probes) run at real time with no fixture.
- What setup cannot make true: a focus session "running" (the session is real state, not a file), an outreach
  "sent 10 min ago" (the notes describe it; outreach.jsonl is evidence, not rewound), and the timestamp OpenClaw itself
  stamps on a turn, which is real time.
- Regex grading: `reply_must` against the last turn's reply, `reply_must_not` against every turn's. `"/x/i"` or plain
  `"x"` (case-insensitive). Rubric grading is left to the separate grader.
- Output, in `~/.openclaw/orion-controlled/evals/gate/run-<stamp>/`: `results.jsonl` (per item: every turn's exact
  message, reply, routing, tools, thinking level, session status; the effect diff; cleanup actions and
  verification; regex checks), `summary.json`, `run.log`, `scenarios.json`.

## What the eval-mode marker really does

`~/.openclaw/orion-controlled/eval-mode` counts as live while its mtime is under two hours old (`lib/eval-mode.mjs`).
Read from the code, while it is live:

- **Suppressed:** `orion-reach`, `orion-messages-send` and `orion-discord-alert` print "Not sent" and exit 0 (phone,
  iMessage, Discord). `orion-watch` and `orion-ontask-watch` pause.
- **Redirected:** check-ins go to `eval-checkins.json` instead of `checkins.json`; `orion-remote` does not save a
  profile statement; `orion-reschedule` done-early skips closing his check-in loops and focus session.
- **Calendar: sandboxed only per item.** The sandbox calendar and clock need the marker AND `eval-calendar.json`
  (`lib/life/bridge-path.mjs`, `local-routing.ts undoJournalTop`, `plugin-clock.ts`). The runner writes that file only
  for an item with `setup.calendar` and removes it when the item ends (above). For every other item calendar writes
  are real and go to the normal undo journal. The runner **refuses to start** if someone else's `eval-calendar.json`
  exists beside a live marker, and each item refuses to start while any sandbox file is present.

Cost of holding it: while it is held, ORION's genuine proactive messages and watchers are silenced too, and the
three redirects above make those particular write paths slightly less faithful. `--eval-mode on` (default) is the
safe choice because an outbound send to Nick's phone cannot be undone. `--eval-mode off` is for runs where you
accept real sends.

Release guarantees (`lib/marker.mjs`): removed in a `finally`; on SIGINT/SIGTERM/SIGHUP (the runner first finishes and
undoes the in-flight item; a second signal leaves at once); at max age (`--max-age-min`, default 90; the run stops
before the next item); and removed only if it still holds this process's token. The file is kept backdated 105
minutes and refreshed every minute, so if the process is SIGKILLed the marker stops counting about 15 minutes
later by itself. It refuses to start over someone else's live marker.

## Undo guarantees, and their limits

Per item: snapshot, run, **record the diff**, undo, verify. What is restored: the calendar through
`orion-reschedule undo` once per new journal entry, then the journal file itself (the journal keeps only 10);
about two dozen plugin state files, `USER.md`, `MEMORY.md` and `workspace/memory/*.md` byte for byte;
`inbound-turns.jsonl` by truncation; Apple Reminders to-dos completed or reopened to match; a focus session the item
started is abandoned and released. `verify` re-reads all of it and lists anything that did not come back.

Limits, stated so they are not discovered later:
- **Calendar verification is the undo's own report** ("Undone: …" for every new entry), not an independent read of
  the calendar; `orion-reschedule show` needs Calendar access that only launchd runs have. An item that makes more
  than 10 calendar changes is flagged `UNDO INCOMPLETE`.
- If an item *undoes one of Nick's earlier real changes* (a bare "cancel that"), that is flagged `HAZARD` and not
  restorable here.
- Ledgers and audit logs (`task-ledger.jsonl`, `outreach.jsonl`, `held.jsonl`, `slips.jsonl`, `life-history.jsonl`,
  `focus-history.jsonl`, `outbox.jsonl`) are reported as appended lines, never rewound: they are evidence.
- Other top-level files that changed during an item are listed in `effect.otherChanged` but not restored; they may
  be background processes, and overwriting them would be worse than reporting them.
- Anything outside those files (a sent message with `--eval-mode off`, a file written elsewhere, a gateway session
  transcript, `orion-created-events.json` entries pointing at deleted events) is out of reach.
- A hard kill (SIGKILL, power) mid-item leaves that item's changes in place; `--recover <out dir>` restores from the
  `inflight-snapshot.json` written before every item.
- Run when Nick is not relying on ORION: for the duration the marker silences proactive sends, and a "start a focus
  session" item really starts one if his own has ended (it is abandoned afterwards).

## How the port can still differ from the app

- `\b` in the thinking and scheduling regexes: ICU is Unicode-aware, JS is ASCII-only (differs only beside a
  non-ASCII letter). `.` excludes slightly different line terminators.
- The app's thinking level is computed on the whole request including the app-context block, which alone is over
  35 words, so every typed or spoken turn without an `ollama/` model gets `--thinking low`. The port reproduces that.
- `selectedChatModel` is nil in most chats (no `--model`); pass `--model` to match a picked one.
- Allowed-apps list (see above), the ten-minute thinking boost (kept in the runner's memory, as the app keeps it in its
  own), and `QuickAnswer` text for clock questions (reproduced, but not golden-tested).
- GOG_KEYRING_PASSWORD: environment, then `~/Desktop/ORION/.env`; `launch.sh` forwards it into the launchd job's
  environment because launchd cannot read that file. The generated plist is deleted right after loading.
