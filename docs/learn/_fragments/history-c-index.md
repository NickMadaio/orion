# history-c index (chapter 02c, history 2026-09-21 to 2026-10-01)

Fragment for the editor. Scope: items *introduced or changed* by the 198 commits `8ef85c8` .. `d96cab3`, with citations at HEAD `6c93032` (paths and line numbers may have shifted after the range; the Introduced column says which commit). Secrets are named by Keychain item or env var only. Items the chapter only mentions in passing are marked "(see chapter)".

### API calls
| Service | Endpoint / method | Called from (path:line) | Auth (by name only) | Purpose |
|---|---|---|---|---|
| Ollama (loopback) | `POST {endpoint}/api/generate` (streaming; `keep_alive:0` with empty prompt = unload) | `scripts/lib/agentic/models.mjs:213`, `:299` | none (loopback) | Worker/reviewer/repair/extension/recovery generations; model eviction. Introduced `a32a8ae`, streaming `a63f1f2` |
| Ollama (loopback) | `GET {endpoint}/api/ps` | `scripts/lib/agentic/models.mjs:283` | none | Which models are resident; exclusive residency check (`ensureExclusive`, `:387`). Eviction poll up to 20 s added `5da0855` |
| Ollama (loopback) | `GET {endpoint}/api/tags` | `scripts/lib/agentic/models.mjs:291` | none | `probe()`: is the model installed. One-token generation added `a63f1f2` |
| OpenClaw gateway | `openclaw agent --session-key <key> --timeout <s> [--model M] --thinking <level> --json --message-file <f>` | `scripts/orion-remote:798-812` | gateway's own provider keys (not read here) | The brain turn for every phone/Discord/voice message. `--thinking` added `7e1ea26` (fixed "low"; HEAD uses `thinkingLevel()`); `--model` from `ORION_BRAIN_MODEL` |
| Anthropic (via OpenClaw model id) | model id `anthropic/claude-sonnet-5` | `scripts/orion-remote:697-700` | OpenClaw provider config | Truth-check retries re-ask on Sonnet 5 (decided 09-29, HANDOFF 15:42; committed `c2eda84`) |
| Apple CloudKit | container `iCloud.com.nickmadaio.orion`, private DB, zone `OrionLink`, record types `MacState`, `LinkCommand`, `LinkAlert` | `native/OrionLink/Sources/LinkCore/` (CloudLink on Mac); `native/OrionMobile/App/CloudLink.swift` | iCloud account + signing team (no secret in repo) | Phone-Mac link. Built 09-28, committed `b59bdca`, `7724c43` |
| Mac calendar/reminders bridge (local binary) | JSON ops: `move_calendar_event`, `list_incomplete_reminders` (with `list`, `due`), `list_reminder_lists`, `move_reminder`, `create_reminder(list)`, `complete_reminder`, `delete_calendar_event(span:future,start)`, `list_deadlines`, `get_calendar_event` | `native/OrionMacBridge/Sources/OrionMacBridge/Bridge.swift`; callers `scripts/lib/life/calendar-write.mjs`, `scripts/lib/life/live-day.mjs`; override `ORION_BRIDGE_BIN` (`scripts/lib/life/bridge-path.mjs:22-39`) | macOS TCC grants (Calendars, Reminders) | All calendar/reminder reads and writes for the life loop. Extended in `7724c43`, `1fc1162`, `3034d64` |
| WHOOP (via the ORION app) | `WhoopClient.exportNights` writes `~/.openclaw/orion-controlled/sleep-actual.json` | read at `scripts/orion-watch:75`, `scripts/lib/life/night.mjs` | WHOOP OAuth stored by the app (not in repo) | Actual sleep/wake for the wake line. `017d51c` |
| Discord (via alert scripts) | `scripts/orion-discord-alert`, `scripts/orion-messages-send` (blocked in eval mode) | `scripts/lib/eval-mode.mjs`; escalation notifier in `scripts/lib/agentic/escalation.mjs` | Discord bot token (Keychain, not read here) | Escalation briefs; informational reviewer-repair line; alert digests. Eval-mode guard `c2eda84` |
| TfL, Canvas (declarative GET-only connectors) | `scripts/orion-connect run <name>`; specs `scripts/lib/connect/spec.mjs`, built-ins `connectors/tfl.json`, `canvas.json` | `scripts/orion-connect` | Keychain item "ORION Canvas" (Canvas token); TfL key by Keychain | Live data connectors. `c2eda84` |

### System prompts / instruction text sent to models
| Name | Source (path:line) | Sent to (model/route) | When | Summary |
|---|---|---|---|---|
| Worker system prompt | `scripts/lib/agentic/prompts/worker-system.md:1` (loaded by `systemPrompt('worker-system')`, `scripts/lib/agentic/prompts.mjs:32`) | `qwen3.6:27b` worker role (Ollama) | every worker exchange | "You run unattended… You cannot accept your own work." Step 0 find what already exists; FILE/EDIT/CHECK/READ/SEARCH/SUBTASK/DONE vocabulary; attempts vs turns; escalation ladder. Introduced `a32a8ae`; turns/attempts fix `f2eab40`; EDIT `09-25`; "already satisfied" `09-25` |
| Reviewer system prompt | `scripts/lib/agentic/prompts/reviewer-system.md` | `qwen3.6:27b` reviewer role, thinking on | per task review and final review | PASS / PASS_WITH_TASKS / BLOCKED; per-criterion judgement; item 9 "existing work destroyed"; judges one checkpoint (`diffForCheckpoint`) |
| Reviewer repair prompt | `scripts/lib/agentic/prompts/reviewer-repair.md` | reviewer role | when worker is stuck/timeout | Smallest change (bare minimum 2 files, was 6); JSON diagnosis first so a cut-off reply keeps it |
| Deadline-extension prompt | `scripts/lib/agentic/extension.mjs:67` (`decideExtension`) | reviewer role, no thinking | at exchange boundary when time will run out | Grants 0-45 min plus ETA; fallback 20 min. 09-25 |
| Runtime-recovery prompt | `scripts/lib/agentic/recovery.mjs:43` (`recoverRuntime`) | reviewer role, 120 s deadline | on a thrown loop/review/repair error | Diagnose; authorise retry, unload-and-retry, or human escalation; 2 per phase / 6 per run. 09-22 |
| Plan briefs (per task) | `docs/agentic/plans/<plan>.briefs/<task>.md` + `common.md` | worker/reviewer as task context | each task | Written by Claude/Astra: exact signatures, test recipes, traps, exchange plan. Standard `docs/agentic/PLAN_STANDARD.md` (09-25) |
| Brain brief / live facts | `scripts/orion-remote` (`briefFor(sender)`, live facts lines for phone lock, today's events, travel/rank lines) | OpenClaw brain | each message | Per-channel line (`@discord` / `@phone`), "never paste the to-do list", phone-lock status, scheduling rules. 09-28, `0ee7ea6`, `936b695`, `1bcf4ad` |
| Spoken-turn instruction | `scripts/orion-remote` ("one to three short sentences") | brain, voice turns | voice | 09-29, `a796471`/Mac voice work |
| ORION operating text (AGENTS.md/TOOLS blurbs) | `plugin/workspace/AGENTS.md`, `plugin/workspace/USER.md`, `TOOLS.md` (generated) | brain | every turn | Scheduling rules (never invent a time, `drop` not undo, use `now`, never paste the list), phone-time guidance ("decide like a friend…"), "combine = remove + add". `5e29292`, `3034d64`, `0ee7ea6` |
| Surfaces plan/briefs | `docs/agentic/plans/orion-surfaces.md:1` + 13 briefs | Qwen worker | 10-01 run | UI/early/focus/phone-lists/chat-store tasks. `55c5648` |

### Memory reads/writes (anything that persists knowledge about Nick or the conversation)
| Store (path or system) | Op (read/write) | Code (path:line) | What |
|---|---|---|---|
| `~/.openclaw/orion-controlled/life-config.json` (`eval-` prefix in eval mode) | read/write | `scripts/lib/life/config.mjs:10`; writer `scripts/orion-life` | Nick's rules and minimums (`orion-life min nap 75`), `usualWake`, `bedtime`, `readyMinutes` 105 (`:22`), `bufferMinutes` 10, `todoList` "Orion", `sweepLists`, `ignoreTitles` |
| standing rules from his words | write (before the model answers) | `scripts/lib/remote/standing-rules.mjs:23-47` (`readStandingRules`), wired in `scripts/orion-remote` | saves "always / going forward…" statements and "at least" minimums (`3034d64`) |
| `~/.openclaw/orion-controlled/reschedule-undo.json` (`eval-` prefix in eval) | read/write | `scripts/lib/life/calendar-write.mjs:11` | undo journal: one change = one step; deleted event contents kept to restore |
| `~/.openclaw/orion-controlled/checkins.json` | read/write | `scripts/orion-checkin:31` | follow-through loop state |
| `~/.openclaw/orion-controlled/life-history.jsonl`, `patterns.json` | write/read | `scripts/lib/life/history.mjs:13-14` | planned-vs-actual, lateness, wake median |
| `~/.openclaw/orion-controlled/night.json` | write by `orion-watch`, read by Mac `NightMarkers.swift` | `scripts/orion-watch:93-97` | wake and asleep-by per day (`35e4889`) |
| `~/.openclaw/orion-controlled/sleep-actual.json` | write by app, read by `orion-watch` | `scripts/orion-watch:75` | WHOOP fell-asleep/woke times |
| `~/.openclaw/orion-controlled/health-log.json` | read/write under `<file>.lock` | `scripts/orion-phone-time:17`; `native/OrionLink/Sources/LinkCore/TrackingLog` | water/meals/supplements, `phoneScreen`, `screenLog`, `phoneSignals` (last 2000), `sleepLog` |
| `~/.openclaw/orion-controlled/screen-grant.json` | write by `orion-phone-time`, read by link snapshot | `scripts/orion-phone-time:18` | extra phone time grant (id, until, because) |
| `~/.openclaw/workspace/memory/YYYY-MM-DD.md` ("## From the iPhone") | write | `native/OrionLink/Sources/LinkCore/MemoryNote.swift:4-10` | phone "note that… / remember…" and offline conversations |
| episodic auto-capture | write | `plugin/orion-control/src/episodic.ts:70` (`nickWords`) | fixed 09-29: it had saved the transport brief as Nick's words (5 junk entries removed) |
| `~/.openclaw/orion-controlled/attention.json` | read/write | `scripts/orion-attention:17`; `scripts/lib/attention/store.mjs` | attention queue (atomic, mode 0600); Today feed `attention-today.json` |
| `~/.openclaw/orion-controlled/cron-delivery-history.jsonl` | write | `scripts/orion-cron-deliver:59` | one outcome line per delivery run (v, at, label, outcome, exitCode only). `9c36b1c`, fixed `4a2816d` |
| `~/.openclaw/orion-controlled/project-agent/projects/<id>/` | read/write | `scripts/lib/agentic/projects.mjs:10-13` | run state, journal, heartbeat, `activity.json`, plans, briefs, bench-journals |
| `~/.openclaw/orion-controlled/agentic-config.json` | read (never written for `enabled`) | `scripts/lib/agentic/models.mjs:41`; `scripts/lib/agentic/settings.mjs:17,47,73-76` | execution gate and model roles |
| `docs/vision/ORION_PURPOSE.md` | read by humans/agents | file head | Nick's mission and priority order (09-29) |
| Basic Memory / Obsidian brain | none in this range | (see next chapter) | the Basic Memory brain starts 10-05 |

### Tool calls (tools exposed to a model, or CLIs a model invokes)
| Tool / CLI | Defined at (path:line) | Who calls it | Args | Side effects / gate |
|---|---|---|---|---|
| Worker tool vocabulary (FILE, EDIT, CHECK, READ, SEARCH, SUBTASK, DONE) | `scripts/lib/agentic/prompts/worker-system.md`, parser `scripts/lib/agentic/prompts.mjs`, `edits.mjs:16` (`applyEdits`) | Qwen worker | markers in reply text | Writes pass structure, containment, scope, deny-list, installed self-change policy; `overwriteRisk` (`existing.mjs:123`); never a shell |
| Registered checks | `scripts/lib/agentic/checks.mjs` (`node-syntax`, `scope-tests` `:160`, `doc-report`, `automation-install-tests`, `automation-tests`, `mobile-swift-tests`, `mac-build`, `phone-build`) | host only | fixed argv | local `node --test` etc.; paths only from approved scope |
| `orion-agent`, `orion-projects` (`rebrief`, `add`, `import`), `orion-project-agent` (`set-model`, `alerts quiet|away`, `--until`, `--until-stopped`), `orion-runs` | `scripts/orion-agent:1`, `scripts/orion-projects:1`, `scripts/orion-project-agent:1`, `scripts/orion-runs:1` | Nick, Discord `agent`, ORION (read-only `orion-runs`) | see headers | start/stop/pause/exterminate runs; `enabled` stays file-only |
| `orion-reschedule` verbs: `late busy overrun now add fill day tidy clear drop skip extend resize rename move swap undo early` | `scripts/orion-reschedule:1-30`, option table `:96-103` | ORION brain (allowlisted) | per verb | writes Calendar via bridge in one reversible transaction; refuses with "NOTHING WAS CHANGED" if the projected day breaks `checkDay` (`scripts/lib/life/day-check.mjs:19`) |
| `orion-watch` | `scripts/orion-watch:1` | the ORION app every 5 min (`LifeWatch.swift`) | none | asks about empty days, short-night nap, writes `night.json`, sweeps reminders |
| `orion-checkin` | `scripts/orion-checkin:1` | phone link, ORION | `tick --json`, `defer --snooze` | check-in pushes; level-3 engages Focus lock |
| `orion-now`, `orion-next`, `orion-study`, `orion-plan-study`, `orion-patterns`, `orion-life`, `orion-health`, `orion-log` | `scripts/orion-*` (1 each) | ORION brain | read mostly; `orion-life` writes config | `orion-life min` saves a minimum |
| `orion-phone-time status|grant <min|HH:MM> --because|revoke` | `scripts/orion-phone-time:1-30`, `MAX_MINUTES=60` `:21`, SENT NOT CONFIRMED `:77` | ORION brain (allowlisted) | | writes `screen-grant.json`; honest "sent" until the phone confirms |
| `orion-wake`, `orion-show <tab>` | `scripts/orion-wake:1`, `scripts/orion-show:1` | ORION brain | | phone alarm request; Mac tab switch via `orion://show/<tab>` |
| `orion-attention` (list/show/add/ack/snooze/prune), `orion-attention-collect`, `orion-costs`, `orion-incident-timeline`, `orion-focus-report` | `scripts/orion-attention:1`, etc. | Nick; ORION (read) | `--file --days --now --json` | fixture/ledger readers; attention writes queue file |
| `orion-connect` (+ `orion-connect-admin allow-writes`), `orion-finance`, `orion-shortcut` | `scripts/orion-connect:1`, `scripts/orion-finance:1` | ORION | | GET-only connectors; writes need admin step (not allowlisted) |
| `orion-eval-run`, `orion-eval-grade`, `orion-eval-schedule` | `scripts/orion-eval-run:1`, `scripts/orion-eval-grade:1`, `scripts/orion-eval-schedule:1` | Claude/Nick | | eval marker blocks real sends; schedule eval uses a sandbox calendar |
| `orion-undo`, `orion-approve` (`--chat`, `revoke-chat`), `orion-lock`, `orion-mode` (`--within`) | `scripts/orion-undo:1`, `scripts/orion-approve:1`, `scripts/orion-lock:1`, `scripts/orion-mode:1` | Nick/app (not ORION's allowlist for `orion-undo`) | | trash undo; approvals; owner re-auth for relaxing |
| `terminal_run` plugin action | `plugin/orion-control/src` (Phase 52, flag-gated) | ORION via approval | one zsh command | `sandbox-exec`, 2 min, 20 KB; needs approval every time or "allow for this chat" (8 h cap); `enableRawTerminalActions` off |
| `orion-ontask`, `orion-session start --minutes N|--until` | `scripts/orion-ontask:1` (surfaces, `70c69b8`) | ORION/Mac | status, snooze, allow, wrong, act, log | focus state in `ontask-state.json` |
| `orion-tts-install`, `orion-voiceid-install`, `orion-remote-install` | `scripts/orion-tts-install:1` etc. | Nick | | install copies under `~/.openclaw/...` and launchd; **install scripts are human-run** |

### Config flags & env vars
| Name | Where read (path:line) | Default | Effect |
|---|---|---|---|
| `agentic-config.json` `enabled` | `scripts/lib/agentic/settings.mjs:17,47,73-76`, `models.mjs:41` | absent (disabled) | Whether a model may change real code unattended; never written by the app |
| `taskTimeoutMs`, `taskHardTimeoutMs`, `maxTurnsHard`, `repairRetryAttempts`, `evictWaitMs`, `evictPollMs`, `resourceSettleMs` | `scripts/lib/agentic/models.mjs:111-119,399-404`; `recovery.mjs:41` | 60 min, 4 h, 40, 3, 20 s, 1 s, 180 s | loop budgets |
| `MAX_TURNS` | `scripts/lib/agentic/worker.mjs:39` | 14 | turns per attempt |
| `ORION_BRAIN_MODEL`, `ORION_BRAIN_THINKING`, `ORION_ESCALATION_MODEL` | `scripts/orion-remote:697-700, 803-810` | unset / `thinkingLevel()` (was `low`) / `anthropic/claude-sonnet-5`, `off` disables | brain model/thinking/escalation |
| `ORION_REMOTE_ALLOW` | `scripts/orion-remote:192` | `local` | sender allow-list; the phone runs with `phone` |
| `ORION_BRIDGE_BIN` | `scripts/lib/life/bridge-path.mjs:22-39` | real bridge | tests/sandbox calendar |
| `ORION_CONTROLLED_DIR`, `ORION_HEALTH_LOG`, `ORION_NOW` | `scripts/orion-phone-time:16-24` | `~/.openclaw/orion-controlled` | test seams |
| `ORION_EVAL_MARKER` / eval-mode file | `scripts/lib/eval-mode.mjs:10-13` | `~/.openclaw/orion-controlled/eval-mode`; expires after 2 h | blocks real Discord/Messages sends; sandbox calendar/clock |
| `ORION_LIFE_HISTORY`, `ORION_PATTERNS_FILE`, `ORION_CHECKIN_FILE` | `scripts/lib/life/history.mjs:13-14`, `scripts/orion-checkin:31` | under controlled dir | test seams |
| `ORION_CATALOG_DIST` | CI inventory/deferral checks (`scripts/orion_v2_ci_check.sh`) | installed plugin | CI reads `plugin/orion-control/dist` (`a17299f`) |
| `GOVERNED_SELF_DEVELOPMENT_ENABLED` | legacy `scripts/orion-code` | false, untouched | legacy coder gate (chapter 09) |
| `enableRawTerminalActions` | plugin config | off | gates `terminal_run` (Phase 52) |
| life config: `readyMinutes`, `commuteMinutes` 30, `homeGapMinutes` 150 (HEAD only), `bufferMinutes` 10, `ignoreTitles`, `todoList`, `sweepLists`, `usualWake`, `bedtime`, `sleepHours` | `scripts/lib/life/config.mjs:22,52`, `commute.mjs:8` | see source | planner and night rules |
| `maxPerHour` 2, `maxPerDay` 8 | `scripts/lib/attention/budget.mjs:10-12` | | attention interruption budget |
| `MAX_MINUTES` 60, `STALE_MINUTES` 15 | `scripts/orion-phone-time:21-22` | | extra phone time cap; staleness of the phone's lock report |
| `ORION_TTS_*`/daemon | `scripts/orion_tts_daemon.py` | (see voice chapters) | `spoken_times()` for clock times |

### Glossary terms
| Term | Meaning |
|---|---|
| Worker / reviewer / repair | Qwen roles in the dev loop; reviewer may write code (repair) and is recorded separately |
| Task-level escalation / deferral | An escalation that parks one task (`deferred: true`) while independent work continues (`c9ddbec`, 09-25) |
| `settleStatus` | The single function deciding what the loop can do now |
| `diffForCheckpoint` | Shows the reviewer one checkpoint's diff, not the cumulative run diff |
| Attempt vs turn | An attempt is a whole run at a task; a turn is one exchange in it |
| `### EDIT` | SEARCH/REPLACE hunk edit; each SEARCH must match exactly once |
| `recoverableRuntime` | A machine failure that refunds the attempt (eviction, memory pressure, inference timeout) |
| Packet | An investigation document (baseline, requirement matrix, architecture, next slice, test scenarios, gates) |
| `doc-report` | Check that a packet has six sections, all requirement ids and real paths |
| ALREADY SATISFIED | Worker closing note meaning its last exchange changed nothing |
| Orion truthful | Qwen projects that built reply/claim/grant checkers; mostly unwired at HEAD |
| Walls / pinned / flexible | The three kinds of time in `replan.mjs` |
| `checkDay` | The invariant: nothing ORION places overlaps anything; blocks >= 5 minutes |
| Cascade | Day layout where blocks keep their time if free, else slot after the previous block plus the gap |
| `now` verb | `orion-reschedule now` books what he is doing and slides the rest after it |
| Standing rule | A statement like "always/going forward…" saved by code, not by the model |
| SENT, NOT CONFIRMED | State of a phone-time grant to a phone that has not reported |
| Focus lock | Phone Screen Time shield on chosen apps (FamilyControls) |
| MacState / LinkCommand / LinkAlert | CloudKit record types of the phone-Mac link |
| ORION Link | The helper embedded in Orion.app (login item) that talks CloudKit |
| Glance | `OrionGlance` shared data for widgets |
| Surfaces | The 10-01 Qwen plan for finish-early, focus lists, orb, composer, chat store |
| Life loop | plan, remind, observe, intervene, follow up, adapt (`scripts/lib/life/`) |

## Decisions & reversals

| Date | Decision | Alternative rejected / reversal | Who | Evidence |
|---|---|---|---|---|
| 09-21 | Models addressed by role; one resident model on 48 GiB | named models; a larger reviewer co-resident | Claude | `a32a8ae` (20.7 GiB measured) |
| 09-21 | `enabled` lives outside the repo, file-only | UI toggle | Claude/Nick | `a63f1f2`, `settings.mjs:17` |
| 09-21 | Streaming inference; trace to disposable `activity.json` | non-streaming; trace in the journal | Claude | `a63f1f2` |
| 09-21 | Two clocks (plan vs task) | one ring | Claude | `a63f1f2` |
| 09-22 | Task-level escalation, loop continues | run-level halt | Nick ("make sure this loop is able to be continuous") | `c9ddbec` |
| 09-22 | qwen3.6:27b for both roles | quantised 80B coder-reviewer | Claude (measured over 8 candidates) | `c9ddbec`, HANDOFF 09-22 |
| 09-22 | Reviewer re-runs checks; contradiction escalates | trust worker's report | Claude | `d1e7e98` |
| 09-22 | Context bounded, not compacted | summarising failed checks | Claude | `d1e7e98` |
| 09-25 | `### EDIT` hunks | whole-file rewrite only | Claude | HANDOFF 09-25 14:12 |
| 09-25 | Soft task hour with reviewer-granted extension | fixed per-task timeout | Claude | HANDOFF 09-25 14:55 |
| 09-25 | Survey existing work; overwrite guard | blind rewrite | Claude | HANDOFF 09-25 18:43 |
| 09-26 | Broker (Phase 48) not built as code | same-user broker (no boundary) | Claude | batch report |
| 09-26 | Raw terminal behind in-app approval, flag off | Face ID | Nick | batch report |
| 09-26 | `doc-report` check; write-first skeleton | `node-syntax` on Markdown; investigate-then-write | Claude | HANDOFF 09-26 11:44, 15:51 |
| 09-27 | Attention engine designed, fixtures first | copy the packets | Claude | HANDOFF 09-27 09:50 |
| 09-28 | CloudKit as phone backbone; Tailscale optional later | Tailscale/HTTP pairing | Nick | HANDOFF 09-28 09:33 |
| 09-28 | **Reversal:** Mac Home restored to orb home; Today to Tasks | Astra's Today-first Home | Nick | HANDOFF 09-28 11:16 |
| 09-28 | Phone commands run through `orion-remote handle --from phone` | a new API | Claude | HANDOFF 09-28 10:00 |
| 09-29 | Stay on Haiku 4.5; escalate truth-check retries to Sonnet 5 | Sonnet for every turn (~$20/mo) | Nick/Claude | HANDOFF 09-29 15:42 |
| 09-29 | Offline phone brain: rules for actions, model only chats | model with write tools | Claude | HANDOFF 09-29 04:25 |
| 09-29 | Claude takes over unfinished Qwen life-loop tasks | wait for Qwen | Nick | `e7a1f94` |
| 09-30 | Commit in groups and push; `main` fast-forwarded; no trailers | long dirty tree | Nick | `AGENTS.md:140-150` |
| 09-30 | `var/brain` untracked; archive moved out of repo | tracked vault | Nick/Claude | `a27103b` |
| 09-30 | **Reversal:** replacement is one tool; incremental first, priority rebuild if needed | `--replace` as default | Nick | `afe697b` |
| 09-30 | Schedule by time order; importance decides what to drop | order by importance | Claude | `752ac71` |
| 09-30 | Optional workshops ignored (`ignoreTitles`) | plan around them | Nick | HANDOFF 09-30 23:33 |
| 10-01 | Phone grants are "sent" until confirmed | "Done" immediately | Claude | `900bcaa`, `1801a69` |
| 10-01 | One to-do list (Orion); sweep others onto it | plan from all lists | Nick | `1fc1162` |
| 10-01 | Get-ready 105 min | 75 | Nick | `44c1443` |
| 10-01 | Day-rule invariant before every write | per-symptom fixes | Nick | `2602593` |
| 10-01 | Single-block verbs; standing rules saved by code | model retypes day; model remembers | Claude | `3034d64` |
| 10-01 | Thinking low for text, off for voice | thinking off everywhere | Claude | `7e1ea26` |
| 10-01 | Model eviction polls 20 s; failure refunds attempt | one instant check | Claude | `5da0855` |
| 10-01 | Rewrite Qwen's `reply-times` rather than patch | patch | Claude | `4032800` |
| 10-01 | Stage a surfaces plan for Qwen; `native/Orion` closed to it | agent edits Mac app | Claude | `55c5648` |
