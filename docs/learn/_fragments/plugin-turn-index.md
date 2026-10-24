# 05 — Plugin turn pipeline: fragment index

Source: `docs/learn/05_plugin_turn_pipeline.md` (snapshot 6c93032, 2026-10-14). Citations are copied from the chapter; bare line numbers are expanded to the file the chapter was discussing.

### API calls
| Service | Endpoint / method | Called from (path:line) | Auth (by name only) | Purpose |
|---|---|---|---|---|
| Ollama (127.0.0.1:11434) | `POST /api/generate` (warm-up; keep_alive 24h, num_ctx 16384) | plugin/orion-control/src/front-desk.ts:105-110 | none (Ollama, no auth) | Load the 4B front-desk model at registration so the first real call is not a cold load |
| Ollama (127.0.0.1:11434) | `POST /api/chat` front desk decide (stream false, think false, format = 7-field schema, temperature 0, num_ctx 16384, keep_alive 24h) | plugin/orion-control/src/front-desk.ts:56-68 (request), :73-102 (decide); called from plugin/orion-control/src/local-routing.ts:275-278 | none | Classify each message into one of five moves (answer, tool, escalate, ask, ignore); 8 s abort gives an escalate fallback |
| Ollama (127.0.0.1:11434) | `POST /api/chat` qwen3.5:9b, reminder extraction (format time pattern HH:MM plus label up to 100 chars; 30 s) | plugin/orion-control/src/local-routing.ts:177-186 (liveExtractReminder), prompt at :182 | none | Extract time and label for the reminder path; null sends the soft prompt |
| Ollama (127.0.0.1:11434) | `POST /api/chat` qwen3.5:9b, schedule form (format = intentSchema(day); FORM_OPTIONS; 30 s) | plugin/orion-control/src/schedule-flow.ts:233-234 (ask call); live wiring plugin/orion-control/src/local-routing.ts:152-165 | none | Fill a form of up to 4 steps whose block references are real ids of today |
| Ollama (127.0.0.1:11434) | `POST /api/chat` qwen3.5:9b, schedule form correction round | plugin/orion-control/src/schedule-flow.ts:237-242 | none | One retry of the form, with the compile error ("broke a rule") in the prompt |
| Ollama (127.0.0.1:11434) | `POST /api/chat` qwen3.5:9b, plan extraction (schema {where, travel, items up to 8}) | plugin/orion-control/src/schedule-flow.ts:243-251 | none | Split a plan step that has no items into tasks |
| Ollama via OpenClaw gateway | `ollama/qwen3.5:9b` worker turn (modelOverride / providerOverride) | plugin/orion-control/src/local-routing.ts:293-295 | none (Ollama) | Run every non-internal turn on the 9B with tools when local routing is on |
| Anthropic via OpenClaw gateway | `anthropic/claude-haiku-4-5-20251001` primary turn (model chosen from ~/.openclaw/openclaw.json agents.defaults.model; no line in chapter) | plugin/orion-control/src/local-routing.ts:283-292 (plugin leaves the model alone in shadow, window closed, or cloud calendar change) | Anthropic provider apiKey in ~/.openclaw/openclaw.json models.providers.anthropic.apiKey (value not reproduced) | Full-prompt answer when local routing is off or shadow; at the snapshot the account is in a credit-error state (since 2026-10-13T01:02Z) |
| Anthropic via `openclaw agent --model anthropic/claude-sonnet-5` | one truth-check retry, same session, raw text | scripts/orion-remote:723-747 (askBrain); model constant scripts/orion-remote:700-701 | Anthropic provider apiKey as above (not named in chapter beyond openclaw.json) | Retry exactly once when a zero-tool turn claims done or can't; overridable by ORION_ESCALATION_MODEL, "off" disables |
| OpenClaw CLI `openclaw agent --session-key <key> --message ... --json --timeout ... [--model] --thinking` | Mac app chat and voice | native/Orion/Sources/Orion/GatewayClient.swift:115-130 | Mac app passes only GOG_KEYRING_PASSWORD from its own secrets (env var name only; GatewayClient.swift:140-145) | Every Mac chat or voice turn enters the gateway |
| OpenClaw CLI `openclaw agent --session-key <BRAIN_SESSION> --timeout 90 [--model] --thinking <level> --json --message-file <file>` | phone and Discord turns (askBrainOnce) | scripts/orion-remote:790-812 (overall route :790-900) | none in argv; session and model come from env vars listed in section 5 | Message in a 0600 temp file, never argv; 120 s exec safety net |
| OrionLink CLI `node ~/.openclaw/orion-remote/scripts/orion-remote handle --from <sender> --id <id> --at <ms> --mode chat or command -- <text>` | iPhone ORION tab (run by the Mac's OrionLink engine) | native/OrionLink/Sources/LinkCore/CommandRunner.swift:20-60 | sender allowlist (ORION_REMOTE_ALLOW) | Phone turn entry point; guards then askBrain (scripts/orion-remote:1512-1700, :1639) |
| Discord gateway (outbound WebSocket) | Discord bridge | scripts/orion-remote-bridge:1-35 | not named in chapter | Receive allowlisted Discord messages and pass them unchanged to orion-remote handle |
| orion-brain CLI `search <q>` (execFile, 8 s) | pre-fetch of brain matches on every on-mode turn | plugin/orion-control/src/local-routing.ts:142-144 (defaultBrainSearch); brainSnippets :135-140 | none | Up to 4 `## ` blocks, 500 chars each, waited for at most 4 s |
| orion-reschedule CLI `show --json [--date tomorrow]` (execFile) | day read for the scheduling flow and day questions | plugin/orion-control/src/local-routing.ts:147-149 (liveReadDay) | none | Read the whole day, including past blocks, for the form and the day answer |
| orion-reschedule CLI argv (move, add, day --plan, drop, drop --after, resize, extend, skip, swap, tidy) | scheduling flow execution (execFile, 60 s timeout, 1 MiB buffer) | plugin/orion-control/src/local-routing.ts:152-165 (liveScheduleFlow), exec at :154-155 | none | Apply the calendar change compiled by code; no shell |

### System prompts / instruction text sent to models
| Name | Source (path:line) | Sent to (model/route) | When | Summary |
|---|---|---|---|---|
| FRONT_DESK_SYSTEM | plugin/orion-control/src/front-desk-prompt.ts:6 | qwen3.5:4b-q4_K_M via Ollama /api/chat, system role | every non-internal turn, in shadow (fire-and-forget) and on (awaited) | 8,903 chars, hash d4fa34b8be16; decides one of five moves and outputs one JSON object; includes the 17-tool menu and the "How to decide" order; generated by scripts/eval/v3/ops/export-front-desk.mjs ("do not edit by hand", front-desk-prompt.ts:1) |
| SCHEDULING_INSTRUCTIONS | plugin/orion-control/src/job-instructions.ts (constant, no line in chapter) | qwen3.5:9b worker via before_prompt_build systemPrompt (plugin/orion-control/src/local-routing.ts:368-372) | on; front-desk tool agenda, reschedule or tasks, or SCHEDULING regex matches | 10,504 chars, hash 27096e783aa3, frozen config J6; full orion-reschedule and orion-tasks usage, six-step job method, reply rules (times only from command output), multi-turn rules, shared honesty block, two examples |
| BRAIN_INSTRUCTIONS | plugin/orion-control/src/job-instructions.ts (no line in chapter) | qwen3.5:9b worker | on; tool brain or repair_note, or no tool and BRAIN regex matches (checked first) | 2,885 chars, hash f6f140e00bf9, frozen config J5 |
| GENERAL_INSTRUCTIONS | plugin/orion-control/src/job-instructions.ts (no line in chapter) | qwen3.5:9b worker | on; everything else | 2,896 chars, frozen config J2; command reference for exec scripts and orion_task_run actions, plus honesty and rules |
| Shared honesty block (inside the three job-instructions constants) | plugin/orion-control/src/job-instructions.ts (excerpt quoted in chapter section 12, no line) | qwen3.5:9b worker | every worker turn using the three constants | Says how to read each tool result: "Command still running" is not done; "needs approval" is not done yet; "NOTHING WAS", "NOT BOOKED", "did not fit" means it did not happen; with no tool call, never say "I've set/added/turned/started" |
| LOCAL_IDENTITY | plugin/orion-control/src/local-routing.ts:188 | qwen3.5:9b worker on the local route | on | "You are ORION, Nick's personal assistant on his Mac and iPhone. Reply in one to three short sentences ... Never say something happened unless a tool result shows it did." |
| PRODUCTION_NOTES | plugin/orion-control/src/local-routing.ts:202-208 | qwen3.5:9b worker, general branch | on; general worker branch | Five lines: full script paths required on this Mac; read a day with orion-agenda day; never put &, semicolon, pipe or redirect in arguments; "fill the time between two classes" is one move call; read the calendar instead of asking for times |
| LOOK_IT_UP | plugin/orion-control/src/local-routing.ts:132 | qwen3.5:9b worker, general branch | on; general worker branch | Points to the brain manual and orion-brain search; "Never guess a fact about Nick or a command's syntax that you could look up." |
| dateLine() | plugin/orion-control/src/local-routing.ts:191-197 | qwen3.5:9b worker, general branch ("Now:" line) | on; general worker branch | "Today is <Weekday> <YYYY-MM-DD>; tomorrow is ..."; before 05:00 says that "tomorrow" means the day after he sleeps |
| Brain matches block (brainSnippets) | plugin/orion-control/src/local-routing.ts:135-140 | qwen3.5:9b worker, general branch | on; general worker branch | Up to 1,400 chars: first 4 `## ` blocks, 500 chars each, waited for at most 4 s |
| HONEST_STOP | plugin/orion-control/src/local-routing.ts:210 | qwen3.5:9b worker as a finalize revise (second pass) | on; work check still finds a problem | "Undo any change you made in this turn ... then tell Nick in one or two plain sentences what you could not do and why. Do not say it is done." |
| Reminder prompt (ONE orion_task_run call with exact arguments, then reply only if the result shows it was set) | plugin/orion-control/src/local-routing.ts:316-328 (quoted at :324-327) | qwen3.5:9b worker, systemPrompt plus appendContext "[ORION: call orion_task_run now with exactly ... do not reply before calling it.]" | on; REMINDER regex matches | Code builds the exact alarm_set arguments and the exact reply "Reminder set for <Weekday> at <time>: <label>." |
| Reminder fallback prompt | plugin/orion-control/src/local-routing.ts:316-328 | qwen3.5:9b worker | on; extraction failed | Softer template for the call; says "Never use orion-tasks." |
| Reminder extraction system prompt | plugin/orion-control/src/local-routing.ts:182 | qwen3.5:9b, form-constrained | on; REMINDER regex matches | Time of day as 24-hour HH:MM ("around 11" or "11 am" = 11:00); short label; JSON only |
| FORM_PROMPT (scheduling form) | plugin/orion-control/src/schedule-flow.ts:64-90 | qwen3.5:9b via Ollama /api/chat with schema | on; calendar statement (not a question) | "You fill in a form for ORION's scheduler"; SAMPLE-day examples with "never copy these ids"; "Never drop a block and add it again — move it"; output JSON only |
| EXTRACT_PROMPT and EXTRACT_SCHEMA | plugin/orion-control/src/schedule-flow.ts:92-94 | qwen3.5:9b | on; plan step with no items | Returns {where, travel, items[{title, minutes}]} |
| Form correction message | plugin/orion-control/src/schedule-flow.ts:237-242 | qwen3.5:9b | on; a compiled step has an error | "Your form <json> broke a rule: <error>. If what he names is not on his day, use its name as a new title. Fill the form again." |
| Day-question prompt | plugin/orion-control/src/local-routing.ts:344-348 (text at :347) | qwen3.5:9b worker | on; calendar question ending in "?" | "His day ..., read just now from his calendar: <list>. Answer his question from this list only ... Do not call any tools." |
| Exact-reply prompt and appendContext | plugin/orion-control/src/local-routing.ts:354-360 | qwen3.5:9b worker | on; scheduling flow done or say | System prompt: "You already made this change. Reply to Nick with exactly this text and nothing else, and do not call any tools." appendContext: "[ORION scheduler — already done. Your whole reply must be exactly: ...]" |
| Drafted-answer prompt | plugin/orion-control/src/local-routing.ts:365-367 | qwen3.5:9b worker | on; front desk move answer and not a change request | "The front desk drafted this reply: ... If it is right for Nick's message, send exactly that (no tools); otherwise answer him briefly yourself." |
| Ask hint | plugin/orion-control/src/local-routing.ts:370-372 | qwen3.5:9b worker, general branch | on; front desk move ask | "The front desk thought you might need to ask: ... Ask only if no tool can tell you; otherwise do the job." |
| FIX and retryInstruction (work-check retry text) | plugin/orion-control/src/work-check.ts:196-207 (FIX), :210-212 (retryInstruction) | qwen3.5:9b worker, finalize revise | on; findings present, passes below 2 | "Before Nick sees this, fix what the check found:" then one line per finding, capped at 590 chars |
| Finalize revise texts (reminder not yet set; exact reply not matched) | plugin/orion-control/src/local-routing.ts:403-431 | qwen3.5:9b worker, finalize revise with idempotencyKey and maxAttempts 1 | on; reminder not called, or exact reply missing | "You have NOT set the reminder yet ..."; "Ignore the earlier conversation. Your whole reply must be exactly this text ..." |
| Workspace system prompt (AGENTS.md, SOUL.md, USER.md, MEMORY.md, TOOLS.md and friends) | ~/.openclaw/workspace/ (read by the gateway; no repo line in chapter) | Haiku primary turn; same prompt goes to ollama fallbacks | off, shadow, window closed, cloud calendar change, and gateway fallbacks | Full ~17k-token prompt; AGENTS.md cut at 20,000 chars (15f0775); replaced for the 9B by the slim prompt (b4c8b55) |
| Mac app context block, optional spoken-reply instruction, "User message:" marker | native/Orion/Sources/Orion/AppState.swift:2101-2111 | gateway user message (then Haiku or 9B) | every Mac chat or voice turn | "[Orion app context — factual state supplied by the native app]" block; for voice, "Nick SAID this out loud ... one to three short sentences"; then the marker and Nick's words |
| Phone message-file prefix: phoneContext() | scripts/orion-remote:625-672 | gateway user message | every phone turn | Live facts: up to 12,000 chars of ~/.openclaw/workspace/SCHEDULING.md, open apps, today's schedule, check-ins, phone lock, outreach; then "already saved" note, channel brief, marker "--- Nick's message follows ---" |
| CHANNEL_BRIEF with per-channel lines (@phone, @discord) | scripts/orion-remote:493-536; briefFor at scripts/orion-remote:539-546 | gateway user message | every phone or Discord turn | Channel-specific brief; the marker line ends it |
| Standing-rules "already saved" note | scripts/orion-remote:754-788 (saveStandingRules) | gateway user message | a turn in which standing rules were saved from Nick's words | "[orion-remote] Already saved from his message (by the transport, not by you): ... never say 'noted' for anything that is not in this line." |
| Truth-check texts (CHECK_CANT, CHECK_DONE, CHECK_SILENT) | scripts/orion-remote:674-689 | Sonnet 5 retry via openclaw agent --model | zero-tool turn with a done or can't claim, or an empty reply after tools | Retry text sent raw, no brief, same session |
| Fail-fast system prompt ("Reply to Nick with exactly the text below and nothing else. Do not call any tool.") | plugin/orion-control/src/account-health.ts:224-243 | fallback attempts only | only with accountFailFast true (off at snapshot) | Replaces the fallback prompt with the account alert text |
| approval_required message (tool result the model must relay) | plugin/orion-control/src/validator.ts:775-791 | the model, as a tool result | an orion_task_run action needs approval under the current strictness mode | "Action 'X' requires approval because Orion is in 'contained' mode ... Nick can lift it with orion-mode, or approve this one." |

### Memory reads/writes (anything that persists knowledge about Nick or the conversation)
| Store (path or system) | Op (read/write) | Code (path:line) | What |
|---|---|---|---|
| ~/.openclaw/orion-controlled/local-routing/acceptance.json | read | plugin/orion-control/src/local-routing.ts:218-229 (ACCEPTANCE and acceptanceVerdict) | Acceptance record {at, n, pass, medianMs}; must pass the gate (85 percent, 20 s median, 14 days, at least 20 cases) before "on" runs without a testing window; snapshot record fails (7/21) |
| ~/.openclaw/orion-controlled/evals/v3/ledger.jsonl | read | scripts/eval/v3/ops/local-acceptance.mjs:1-18 | Source ledger: latest kind "pipeline" entry copied into the acceptance record |
| ~/.openclaw/orion-controlled/local-routing/acceptance.json | write | scripts/eval/v3/ops/local-acceptance.mjs:1-18 | Written by running `node scripts/eval/v3/ops/local-acceptance.mjs`; the plugin only reads it |
| ~/.openclaw/orion-controlled/local-routing/shadow.jsonl | write (append, one line per turn; file mode 0600, dir 0700) | plugin/orion-control/src/local-routing.ts:437-438 (line shape :533) | {at, mode, runId, message, decision, flow, cloud, model, tools, findings, passes, escalationNeeded, turnMs}; note: the line includes Nick's message text |
| ~/.openclaw/orion-controlled/local-routing/shadow.jsonl.trace | write (one line per hook stage when localRoutingTrace is true) | no writer line in chapter; flag read at plugin/orion-control/src/index.ts:1675 | {at, stage, runId, sessionKey, ...}; contains session keys, no message text |
| ~/.openclaw/orion-controlled/account-health.json | read (every hook) and write (temp file then rename, atomic) | plugin/orion-control/src/account-health.ts:152-171 (state I/O), :161-166 (write), :178-179 (re-read) | Active episode {provider, kind, detail, regainOn, since, lastSeen, alerted[]} or {clearedAt}; episode expires after 24 h without a failure (EPISODE_TTL_MS, account-health.ts:60) |
| ~/.openclaw/orion-controlled/alerts-outbox.jsonl | write (append); the Mac app's LinkEngine reads and truncates it | plugin/orion-control/src/account-health.ts:168-171 | One alert line {id, at, kind "checkin", level 1, text} forwarded to the phone; known race: a line appended between read and truncate is lost (HANDOFF.md 2026-10-12) |
| ~/.openclaw/orion-controlled/places.json | read (cached on first read) | plugin/orion-control/src/schedule-flow.ts:97-107 (knownTravel) | Travel minutes per place; three Spitalfields aliases at 15 min at snapshot |
| Nick's calendar (via orion-reschedule show --json) | read | plugin/orion-control/src/local-routing.ts:147-149 (liveReadDay) | Whole day, including past blocks, for the flow and day questions |
| Nick's calendar (via orion-reschedule move, add, drop, and others) | write | plugin/orion-control/src/schedule-flow.ts:258-266 (run loop); compile at :112-192 | Calendar changes compiled by code; stops at the first output matching FAILED |
| Reminders (orion_task_run alarm_set) | write | plugin/orion-control/src/local-routing.ts:316-328 | Alarm at YYYY-MM-DDTHH:MM with a label; still goes through orion_task_run's own permission and approval gate (26f914d) |
| Orion to-do list (orion-tasks) | write | no writer line in chapter; prompt guidance at plugin/orion-control/src/job-instructions.ts (SCHEDULING_INSTRUCTIONS) | To-dos such as "add X to my to-dos"; orion-tasks refuses unknown options (b5bf4ab) |
| ~/Documents/orionBrain (brain manual and memory) | read | plugin/orion-control/src/local-routing.ts:142-144 (orion-brain search); openclaw.json memorySearch extra path (no line in chapter) | Manual and memory searched for each on-mode turn and by the worker through LOOK_IT_UP |
| ~/Documents/orionBrain/20 Areas/Me/Learned about Nick.md | write (append) | scripts/orion-remote:754-788 (saveStandingRules) | Standing statements from Nick's own words, saved by code before the model answers |
| orion-remember --user | write | scripts/orion-remote:754-788 | Saves the standing statement as memory about Nick; skipped in eval mode |
| Scheduling minimums (lib/life/config.mjs setMinimum) | write | scripts/orion-remote:754-788 | "<thing> should be at least <duration>" becomes a scheduling minimum |
| Standing rules reader | read | scripts/lib/remote/standing-rules.mjs:31-47 (readStandingRules) | Reads saved standing rules (sentence patterns: always, from now on, never again, and similar) |
| ~/.openclaw/workspace/SCHEDULING.md | read (up to 12,000 chars) | scripts/orion-remote:625-672 (phoneContext) | Scheduling notes included in every phone message file |
| ~/.openclaw/workspace/ (AGENTS.md, SOUL.md, USER.md, MEMORY.md, TOOLS.md) | read | gateway reads it into the system prompt (no repo line in chapter; path names at chapter section 1) | Standing workspace knowledge and memory, used by the full Haiku prompt |
| openclaw memorySearch index (memory and sessions; Ollama nomic-embed-text) | read / write (gateway) | openclaw.json agents.defaults.memorySearch (no line in chapter) | Search over memory files and past sessions |
| Gateway session history | read | no repo line in chapter (gateway) | Prior turns of the conversation; source of the paraphrase problem on the CLI route |
| ~/.openclaw/orion-gate/strictness.json | read (once per graph run) | plugin/orion-control/src/index.ts:853-861 (path default index.ts:476-478) | Current strictness mode (contained, guarded, open, sovereign) |
| ~/.openclaw/orion-gate/strictness.json | write (only by the orion-mode script, which the model cannot run) | scripts/orion-mode:42-58 | Strictness mode changed by Nick |
| Trust state (who said what this turn) | write | plugin/orion-control/src/index.ts:1544-1559 (message_received, llm_input); rules at index.ts:1517-1527 | Trusted user text for the run; "the ONLY writers of Orion's trust state"; no store path named in chapter |
| Repeat-guard state (per run, capped at 64 runs) | write and read, in process | plugin/orion-control/src/index.ts:1580-1625 | Signatures of tool calls; third identical consecutive call and fifth identical total are blocked; lockout after 3 blocks (REPEAT_LOCKOUT, index.ts:1537) |
| Local-routing Run state (in process; keyed by runId and session:<key>) | write and read, in process | plugin/orion-control/src/local-routing.ts:69-82 (Run type); keyed at :279-282 | Decision promise, tools collected by after_tool_call, passes, findings, flow result, cloud flag |
| Exact or honest reply memory (in process, 120 s) | write at finalize, read and delete at delivery | plugin/orion-control/src/local-routing.ts:378-387 (reply_payload_sending) | Replaces the outgoing text with the stored exact or honest line; does not fire on the CLI route (46235d4) |
| Episodic capture daily journal | write (append) | plugin/orion-control/src/index.ts:1687-1719 | High-signal preferences and corrections from Nick's latest turn; journal path not given in chapter |
| orion-remote reply audit (lint findings) | write | scripts/orion-remote:813-863 (envelope and lintReply) | Remaining meta_talk, time_24h, time_both and repeated_sentence findings; audit store not named in chapter |

### Tool calls (tools exposed to a model, or CLIs a model invokes)
| Tool / CLI | Defined at (path:line) | Who calls it | Args | Side effects / gate |
|---|---|---|---|---|
| orion_task_run (plugin typed tool, catalog actions) | definition not cited in chapter; run binding at plugin/orion-control/src/index.ts:1646-1652 | qwen3.5:9b worker (on) and Haiku (off, shadow); reminder path makes the call by code instruction | {"steps":[{"action":"alarm_set","at":"<YYYY-MM-DD>T<HH:MM>","label":"<label>"}]}; actions listed in GENERAL_INSTRUCTIONS: weather_now, alarm_set(at, label), reminder_cancel, reminder_list, timer_set, app_open, browser_open_url, media_*, volume_set, supplement_* | Strictness gate and approval (validator.ts:775-791); repeat guard; reminder path forces the call (local-routing.ts:316-328) |
| exec (host tool, allowlisted scripts by absolute path) | host tool; before_tool_call routing at plugin/orion-control/src/index.ts:1633-1644; rules at plugin/orion-control/src/exec-routing.ts:76-139 | qwen3.5:9b worker and Haiku | Argv for one allowlisted program with plain arguments; no shell operators (pipe, redirects, semicolon, ampersand, command substitution) | Allowlist; routeForDoomedExec blocks a command that would be refused anyway, with a reason the model can act on |
| orion-reschedule (CLI) | scripts/orion-reschedule (show --json at :217-223) | schedule-flow code via execFile (local-routing.ts:152-165); qwen3.5:9b worker via exec | show --json, move, add, day --plan, drop, drop --after, resize, extend, skip, swap, tidy, undo, --dry-run, --date tomorrow | Writes the calendar; FAILED regex (NOT BOOKED, NOTHING WAS, did not fit, usage:, not a real block, is in the past, no block called, Error) stops the run |
| orion-tasks (CLI) | allowlisted in exec-routing.ts (path not cited in chapter) | qwen3.5:9b worker (scheduling instructions) | add (with --due or --at historically; refuses unknown options since b5bf4ab) | Writes the to-do list; "--at" was ignored and caused the 2026-10-13 00:44 incident |
| orion-agenda (CLI) | allowlisted in exec-routing.ts (path not cited in chapter) | qwen3.5:9b worker | day <today or tomorrow or weekday or YYYY-MM-DD> (PRODUCTION_NOTES) | Read-only calendar view |
| orion-brain (CLI) | scripts/orion-brain (no line in chapter) | plugin code (local-routing.ts:142-144, pre-fetch) and the worker through LOOK_IT_UP | search "<words>" | Read-only search of the brain (8 s timeout in code) |
| orion-lights, orion-session, orion-phone-time, orion-wake, orion-log, orion-show (CLIs) | exec allowlist in plugin/orion-control/src/exec-routing.ts:76-139 (names listed in GENERAL_INSTRUCTIONS, job-instructions.ts) | qwen3.5:9b worker and Haiku | per-tool arguments not in chapter | Per-tool effects not in chapter |
| orion-remember --user (CLI) | not located in chapter | scripts/orion-remote:754-788 (saveStandingRules), not the model | a standing statement about Nick | Writes memory about Nick; skipped in eval mode |
| orion-mode (CLI) | scripts/orion-mode:7-33 (modes) | Nick only; not in the exec allowlist (scripts/orion-mode:42-58) | mode name | Writes ~/.openclaw/orion-gate/strictness.json |
| Front-desk tool menu (17 names: weather, lights, alarm, wake, session, phone_time, agenda, tasks, reschedule, show, app_open, browser, media, log_intake, supplements, brain, repair_note) | plugin/orion-control/src/front-desk.ts:25 (MENU_TOOLS); menu text in plugin/orion-control/src/front-desk-prompt.ts:6 | the 4B front desk only names one; the plugin never runs it | {tool, args} per the prompt (for example alarm: {"at","label"}) | None; decision.tool only selects the worker instruction set (instructionsFor, local-routing.ts:124-128) |
| Scheduling form step kinds (14 values of "do": fill_between, plan, clear_after, move, resize, extend, add, drop, skip, swap, tidy, cannot, ask, answer) | plugin/orion-control/src/schedule-flow.ts:39-57 (intentSchema); compiled at :112-192 | qwen3.5:9b form call (Ollama /api/chat with schema) | Per-kind fields such as what, after, before, with, to, until, minutes, by, where, travel, items, text | Compiled by code to orion-reschedule argv; guards reject nonexistent block ids and moves of FIXED blocks |
| Host tool ids and redirect targets (read, write, exec, web_fetch; system_status, messages_*, app_open) | host tools named in plugin/orion-control/src/exec-routing.ts:76-139 | qwen3.5:9b worker and Haiku | Exec routing tells the model to call these directly (curl or wget to web_fetch; vm_stat or top to system_status; sqlite3 to messages_*; open to app_open) | Routing itself has no side effect; it blocks the exec form and points to the tool |

### Config flags & env vars
| Name | Where read (path:line) | Default | Effect |
|---|---|---|---|
| localRouting | plugin/orion-control/src/index.ts:1671 (schema index.ts:267-278) | off | off, shadow, or on; live value "on" at snapshot |
| localRoutingTestingUntil | plugin/orion-control/src/index.ts:1679; window logic plugin/orion-control/src/local-routing.ts:446-449 | none | Lets "on" run without the acceptance record; must be in the future and at most 48 h ahead; checked again on every turn; live value 2026-10-14T17:04:46Z |
| localRoutingTrace | plugin/orion-control/src/index.ts:1675 | false | Writes one line per hook stage to shadow.jsonl.trace; live value true |
| localRoutingScheduleToCloud | plugin/orion-control/src/index.ts:1681 | false | Sends calendar changes to the configured cloud model (Haiku) instead of the 9B |
| localRoutingLogPath | plugin/orion-control/src/index.ts:1682-1684 | ~/.openclaw/orion-controlled/local-routing/shadow.jsonl | Turn log path |
| accountHealth | plugin/orion-control/src/index.ts:1661 | on | Detection and alerts for provider account problems; live: default |
| accountFailFast | plugin/orion-control/src/index.ts:1667 | false | Answers with the account problem while fresh; ignored when localRouting is on; live: default |
| enableEpisodicCapture | plugin/orion-control/src/index.ts:1687 | false | Appends high-signal preferences and corrections to the daily journal at finalize; live value true |
| strictnessStatePath | plugin/orion-control/src/index.ts:476-478, 861 | ~/.openclaw/orion-gate/strictness.json | Location of the strictness mode file (approval friction) |
| hooks.allowConversationAccess | ~/.openclaw/openclaw.json, plugins.entries.orion-control.config (no line in chapter) | not stated | Set true at snapshot; needed for the hook set in section 4 |
| ACCEPTANCE (minPassRate 0.85, maxMedianMs 20000, maxAgeDays 14, minCases 20) | plugin/orion-control/src/local-routing.ts:218-229 | constants | Gate for "on" without a testing window |
| finalizeWaitMs (5000 ms) | plugin/orion-control/src/local-routing.ts:264-267 (settle) | 5000 | Maximum wait for the front desk decision at finalize in shadow |
| Front-desk timeout (8 s AbortController) | plugin/orion-control/src/front-desk.ts:73-102 | 8000 ms | Timeout gives an escalate fallback |
| Brain search timeout (8 s) | plugin/orion-control/src/local-routing.ts:142-144 | 8000 ms | execFile timeout for orion-brain search |
| FRONT_DESK_CTX (num_ctx 16384) | plugin/orion-control/src/front-desk.ts:21 | 16384 | Constant context size for the 4B; a different value makes Ollama reload the model (e42de88) |
| FRONT_DESK_MODEL (qwen3.5:4b-q4_K_M) and temperature 0 | plugin/orion-control/src/front-desk.ts:56-68 | qwen3.5:4b-q4_K_M; temperature 0 | Model and sampling for the front desk; think is false |
| WORKER_MODEL | plugin/orion-control/src/job-instructions.ts (constant, no line in chapter); used at plugin/orion-control/src/local-routing.ts:293-295 | qwen3.5:9b | Model override for every on-mode turn |
| FORM_OPTIONS (temperature 0, top_k 20, repeat_penalty 1.05, num_predict 500, num_ctx 32768) | plugin/orion-control/src/schedule-flow.ts:59-62 (constant at :62) | as listed | Caps the form at 500 tokens; a runaway list once generated 14k tokens |
| BUFFER (5 minutes) | plugin/orion-control/src/schedule-flow.ts:30 | 5 | Gap between activities in the scheduler |
| LATE_NIGHT_UNTIL (hour 5) | plugin/orion-control/src/schedule-flow.ts (no line in chapter; meansTomorrow at :213-216) | 5 | Before this hour, "tomorrow" means today's date |
| REPEAT_LOCKOUT | plugin/orion-control/src/index.ts:1537 | 3 | Blocks after which all further tool calls in a run are blocked |
| EPISODE_TTL_MS | plugin/orion-control/src/account-health.ts:60 | 24 h | Account-health episode expiry |
| Repeat-guard thresholds (3rd identical consecutive, 5th identical total) | plugin/orion-control/src/index.ts:1580-1625 | 3 and 5 | Tool-call loop block |
| ORION_BRAIN_SESSION | scripts/orion-remote:91 | orion-app-v2 | Session key; the phone sets orion-chat-<id> |
| ORION_BRAIN_BIN | scripts/orion-remote:95 | ~/.openclaw/bin/openclaw | Path to the OpenClaw CLI (test seam) |
| ORION_BRAIN_MODEL | scripts/orion-remote:804 | none | Passed as --model for the whole run |
| ORION_BRAIN_THINKING | scripts/orion-remote:810 | per message (thinkingLevel) | Passed as --thinking; overrides the policy |
| ORION_ESCALATION_MODEL | scripts/orion-remote:700-701 | anthropic/claude-sonnet-5 | Model for the one truth-check retry; "off" disables |
| ORION_REMOTE_ALLOW | scripts/orion-remote:192 | local | Sender allowlist |
| ORION_DEVICE_ID | scripts/orion-remote:163 | hostname | Device routing identifier |
| GOG_KEYRING_PASSWORD | native/Orion/Sources/Orion/GatewayClient.swift:140-145 | from the Mac app's own secrets (value not reproduced) | Only env var the Mac app passes to the gateway |
| thinkingDefault | ~/.openclaw/openclaw.json, agents.defaults (no line in chapter) | off | Default thinking for gateway turns; per-turn --thinking off or low |
| timeoutSeconds (provider 300, agent 600) | ~/.openclaw/openclaw.json, models.providers.ollama and agents.defaults (no line in chapter) | 300 and 600 | Provider and agent timeouts |
| cacheRetention | ~/.openclaw/openclaw.json, agents.defaults.models entries (no line in chapter) | "long" for Haiku and Sonnet entries | One-hour prompt cache |
| models.providers.ollama params (temperature 0.2, top_p 0.9, top_k 20, presence_penalty 0, repeat_penalty 1.0, num_ctx 32768, keep_alive 24h, think false, num_predict 2048) | ~/.openclaw/openclaw.json, models.providers.ollama.models[0].params (no line in chapter) | as listed | Worker sampling and context; fixed after the live 9B ran at Ollama defaults |

### Glossary terms
| Term | Meaning |
|---|---|
| Channel wrapper | Code that turns Nick's words into one `openclaw agent` call: GatewayClient.swift for the Mac, orion-remote for phone and Discord |
| OpenClaw gateway | Vendored third-party agent runtime (~/.openclaw/bin/openclaw). Picks the model, builds the system prompt, runs the tool loop, fires plugin hooks |
| orion-control plugin | The ORION plugin registered into the gateway (plugin/orion-control/src, built to dist/, installed at ~/.openclaw/extensions/orion-control/dist/) |
| Hook | A fixed point in a turn where the gateway calls a plugin function (for example before_model_resolve, before_prompt_build, before_agent_finalize) |
| Front desk | The 4B local model (qwen3.5:4b-q4_K_M) that names one move for each message; its decision steers the turn and does not execute |
| Worker | The 9B local model (qwen3.5:9b) that does the turn with a slim prompt and tools when local routing is on |
| Primary turn | The configured cloud model (Haiku 4.5) answering with the full workspace prompt; used when local routing is off or shadow |
| Local routing | The orchestrator (local-routing.ts) that runs the front desk, swaps the model, builds the worker prompt, runs the scheduling flow, collects tool results, runs the work check, and logs |
| Mode off | Local routing not registered; Haiku answers, plugin guards and observes only |
| Mode shadow | Haiku answers; the front desk and work check run and log only; never revises |
| Mode on | The 9B takes every non-internal turn; the work check may revise; exact replies and honest lines are enforced |
| Testing window | localRoutingTestingUntil: a time-boxed exception that lets "on" run without the acceptance record; at most 48 h ahead |
| Acceptance gate | The check (local-routing.ts:218-229) that reads acceptance.json and refuses "on" unless the real-route record passes |
| Acceptance record | acceptance.json: the last real-route pipeline run (pass rate, count, median time, date), written by scripts/eval/v3/ops/local-acceptance.mjs |
| Move | The front desk's one decision: answer, tool, escalate, ask, or ignore |
| Tier | Front-desk effort label for escalate: quick, standard, or deep; logged only, not used live |
| think (front desk) | Thinking level the front desk suggests (off, low, high); dropped by decide(); the call itself runs with think false |
| Fallback (front desk) | An escalate decision produced by a failure (timeout, HTTP error, unparsable output, invalid move, unknown tool, empty answer) |
| Ignore is never silent | Design rule: ignore still gets a 9B answer, because a wrong "not for ORION" must never swallow a real request |
| Ask (move) | The front desk thinks Nick is missing a detail; the worker gets the hint "Ask only if no tool can tell you" |
| Scheduling flow | Fixed four-step sequence for any statement about Nick's day: read the day, form call, compile to argv, run the scheduler, reply from its output |
| Form | The JSON the 9B fills in the scheduling flow; at most 4 steps; block references are an enum of today's real ids |
| Compile | Pure code (schedule-flow.ts:112-192) that turns each form step into exact orion-reschedule argv and rejects bad steps |
| Correction round | One retry of the form with the compile error in the prompt |
| LLM-Modulo | Pattern named in the code: the scheduler's rules check the model's form, and the model fills it again on error |
| Block id (B1, B2, ...) | Number of a block in today's day listing; the form may only name ids that exist |
| FIXED block | A class or a plan with people; cannot be moved, resized, dropped or swapped by the flow |
| Pinned block | An ORION block that Nick can still move, even though it is not fixed |
| fill_between | Form step that places an item in the gap between two blocks, with 5-minute buffers |
| plan | Form step that runs day --plan with tasks, minutes and arrival time for a stretch of the day |
| Invisible commute | Travel time is folded into plan arrival times, with no Travel event on the calendar (70ebf12) |
| places.json | File of travel minutes per place (~/.openclaw/orion-controlled/places.json) used when a plan has no stated travel |
| Buffer | Five-minute gap the compiler keeps between activities ("his rule") |
| FAILED regex | Pattern in the flow that stops the run at the first scheduler output containing a failure phrase (case-insensitive) |
| Done / say (flow outcome) | Flow outcome done: calls and outputs ready for spokenReply; say: a cannot or ask answer with text |
| spokenReply | Code that writes the reply from the scheduler's own printed lines (12-hour times), never from the form |
| Exact reply | Text built by code that the worker must send word for word, enforced by system prompt, appendContext, finalize revise and delivery rewrite |
| appendContext | Text appended to the latest user message so the model sees the instruction at the end of its input (used because system-prompt-only instructions were paraphrased) |
| systemPrompt override | before_prompt_build returns a whole system prompt, replacing the workspace prompt on the local route |
| Reminder path | The REMINDER-regex branch: code extracts time and label, builds the exact alarm_set call and reply, and forces the call |
| alarm_set | orion_task_run action that creates an alarm at a given time with a label; the path that replaced to-do reminders (b5bf4ab) |
| Work check | Pure code (work-check.ts) that grades tool results and checks the final reply for false or missing claims |
| Finding | One problem the work check reports for a turn (for example "claims what the tools don't show") |
| Revise | Finalize result that asks the gateway for another model pass; at most two per turn |
| Honest stop / HONEST_STOP | Second retry text: undo any change, then say plainly what could not be done |
| Honest line | The fixed sentence that replaces a reply still making a false claim after the revises (remembered for delivery) |
| Idempotency key | Key on each revise (runId plus kind plus count) so the same revise is not repeated |
| Outcome grades | Tool result grades: success, partial, nothing, pending, failed, read; text-based because exit is always null live |
| falseClaim | Reply says a change was made with no success in the tool evidence |
| omittedFailure | A final failure in the tool evidence that the reply does not acknowledge |
| falseDenial | Reply says something did not happen although the tools show it did |
| wrongDetail | A time in a done sentence that is not a booked start or end |
| unbackedPromise | A promise ("I'll", "let me") with no attempt behind it |
| asked instead of acting | Finding: a change request ends with a question and the tools changed nothing |
| promised but did not act | Finding: a change request promises action and the tools changed nothing |
| Ground truth | What the tools printed, not what the model says; the design principle of the work check |
| Canonical call | Tool-call string built by canonicalCall(), for example "exec orion-reschedule move ..." |
| Run (local routing) | Per-turn state object (message, decision, tools, passes, findings, flow, cloud) stored by runId and session key |
| Settle | Waiting for the front-desk decision at finalize, at most finalizeWaitMs (5 s) |
| Cloud route (run.cloud) | A calendar change sent to Haiku because localRoutingScheduleToCloud is true |
| Brain | ORION's memory and manual (~/Documents/orionBrain), searched with orion-brain search |
| LOOK_IT_UP | Worker instruction to search the brain rather than guess facts or command syntax |
| PRODUCTION_NOTES | Five lines added because the evaluation sandbox did not match the live system (eval is not production) |
| Eval-frozen prompt | A prompt generated by an ops script from a measured config; hand edits break the link to its numbers |
| Gauntlet | A live run of real requests on Nick's real calendar (for example 3/8 at 15:44, 12/12 at 16:15 on 2026-10-12) |
| B4 incident | 2026-10-12 ~13:17: a test without a scheduleFlow stub ran the real scheduler and wrote a block named B4 to Nick's calendar; fixed by removing the default and rejecting nonexistent ids |
| Internal session | A session whose key matches cron, heartbeat, doctor, test, subagent or eval; skipped by local routing and account health |
| Provenance hooks | Always-on hooks that record who said what (message_received, llm_input) and gate tool calls (before_tool_call, after_tool_call) |
| Trust state | Record of the authenticated user turn; if no hook fires, gated actions fail closed |
| Repeat guard | Blocks identical repeated tool calls and, after three blocks, every further tool call in the run |
| Repeat lockout | State after three repeat-guard blocks: every further tool call in the run is blocked |
| Exec routing (routeForDoomedExec) | Pre-refusal that blocks an exec command that would be refused anyway and tells the model the route that works |
| Allowlist (exec) | Set of programs the exec tool may run, by absolute path only (23 wrapper names in exec-routing.ts) |
| Strictness mode | "WHAT IT COSTS" axis: contained, guarded (default), open, sovereign; decides whether an action needs Nick's approval |
| The floor | Actions no strictness mode lowers: changing what Orion may do, reaching a third party, anything irreversible |
| needs approval / approval_required | Result meaning the action is waiting for Nick; not done yet; the model must say so and give the code |
| Channel brief | Per-channel text (phone, Discord) added to the message file before Nick's words |
| Message file | Temp file (0600) holding the full message for openclaw agent --message-file; keeps text out of argv |
| Marker | The line that splits context from Nick's words: "--- Nick's message follows ---" (phone) or "User message:" (Mac); userText() keeps only what follows |
| Standing rule | A durable instruction from Nick's words ("always", "from now on", "never again") saved by code before the model answers |
| quickAnswer | Code answer to the whole plain question "what time is it" or "what day is it", with no brain round trip |
| Truth check | One Sonnet retry when a zero-tool turn reports done or can't, or returns an empty reply |
| CHECK_DONE / CHECK_CANT / CHECK_SILENT | The three truth-check classes: completion claim, inability claim, empty reply after tools |
| fixReply / lintReply | Envelope cleanup (24-hour to 12-hour times, duplicates, repeated sentences) and the audit findings it records |
| Gateway fallbacks | Models tried after the primary fails (ollama qwen3.5:9b, then llama3.2:3b), with the same full prompt |
| Account health episode | One provider-account problem (credit, usage_limit or auth), alerted once, expired after 24 h without failure |
| Fail-fast | Opt-in: answer at once with the account problem instead of falling back to slow local models (off at snapshot; ignored when on) |
| Alerts outbox | alerts-outbox.jsonl: lines the Mac app forwards to the phone |
| Shadow log | shadow.jsonl: one line per turn with the decision, flow, tools, findings and turn time |
| Trace log | shadow.jsonl.trace: one line per hook stage when localRoutingTrace is on |
| Warm-up | Load the 4B once at registration so a cold model does not time out the first turn |
| keep_alive 24h | Ollama setting that keeps the models resident in memory |
| num_ctx | Ollama context size; kept constant per model because a change reloads the model |
| num_predict | Ollama cap on generated tokens (500 for the form, 2048 for the worker) |
| think off / low / high | Thinking level; the local calls run with think false because Qwen thinking is on by default and slow |
| Design-only code | Code that runs in no live turn: conversation routing, modes and personalities; checkCalendar; summarize; reply-times; reply-person |
| Window closed mid-session | With localRouting "on" and the window ended, the prompt hooks do nothing but the finalize revise still runs (from reading the code, not observed live) |
| Honesty block | Shared instructions in the worker prompts on how to read each tool result and what to say |
| Conversation routing / modes / personalities | Designed but not wired: five personalities, three conversation modes, and routeConversation(); no production file imports them |
| orion-remote | Node CLI around every phone and Discord turn: transport guards, standing rules, channel brief, the openclaw call, reply cleanup, truth check |
| Eval is not production | Lesson: scores in the sandbox did not predict the live system; the gate uses a real-route record instead |
