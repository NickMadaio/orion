# scripts-index (chapter 06 fragment)

Merged from helper outputs A2 (life CLIs), B1 (reach), C2 (remote). Sections 2, 5-7, 9 and 10 were added later by an editor from the chapter text and code (rows for sections 2, 5 and 9 are partial: section 2 and 5 have no API calls or prompts; see the main file).

### API calls
| Service | Endpoint / method | Called from (path:line) | Auth (by name only) | Purpose |
|---|---|---|---|---|
| Ollama (local) | POST http://127.0.0.1:11434/api/chat, model `qwen3.5:9b`, JSON-schema `format`, `think:false`, `keep_alive:"24h"` | plugin/orion-control/src/local-routing.ts:152-185 (scheduling form + plan extraction) | none (localhost) | Local worker fills the scheduling intent form |
| Ollama (local) | POST http://127.0.0.1:11434/api/generate, model `qwen3.5:9b`, `num_predict 3` | scripts/orion-watches:121-129 | none (localhost) | Triage verdict "important or not" for texts/mail when plugged in |
| Ollama (local) | POST http://127.0.0.1:11434/api/generate, model `gpt-oss:20b`, temp 0.2 | scripts/orion-standing:709-746 (`--polish`) | none (localhost) | Rewrite standing notice; rejected if it adds a digit string |
| macOS EventKit via OrionMacBridge | JSON-lines on stdin of `orion-mac-bridge`: `list_upcoming_calendar_events`, `list_deadlines`, `create_calendar_event`, `move_calendar_event`, `get_calendar_event`, `delete_calendar_event` | scripts/lib/life/bridge-path.mjs:36-46; scripts/orion-agenda:75-101; scripts/orion-agenda-change:32-61 | macOS Calendar grant of the responsible process (no secret) | Read/write Nick's calendar |
| macOS EventKit via OrionMacBridge | `list_incomplete_reminders`, `create_reminder`, `update_reminder`, `complete_reminder`, `move_reminder`, `list_reminder_lists` | scripts/orion-tasks:74,186,199,226; scripts/orion-agenda-change:119-157; scripts/lib/life/todo-lists.mjs:37-41 | macOS Reminders grant | To-do list (Reminders list "Orion") |
| Gmail (via CLI) | `scripts/orion-gmail-search --json --max 10 "in:inbox newer_than:1d -category:promotions ..."` | scripts/orion-watches:131-136 | Gmail OAuth held by orion-gmail-search (not read here) | Important-mail watch |
| OpenClaw memory index | `~/.openclaw/bin/openclaw memory search --max-results 12 "<query>"` | scripts/orion-recall:51-58 | none (local) | Semantic recall of ORION's memory |
| Discord (indirect) | via `sendDiscordAlert` in scripts/lib/agentic/escalation.mjs | scripts/orion-projects:153 | webhook held elsewhere (not read here) | Alert when a project run fails |
| open-meteo geocoding | GET https://geocoding-api.open-meteo.com/v1/search?count=1&name=<place> | scripts/lib/reach/weather.mjs:12 | none (no key) | Resolve place to lat/lon for weather watches and morning briefing |
| open-meteo forecast | GET https://api.open-meteo.com/v1/forecast (hourly temp, rain, snow, code, wind; 2 days) | scripts/lib/reach/weather.mjs:14 | none | Hourly forecast shared by orion-watches and orion-morning |
| open-meteo geocoding | GET https://geocoding-api.open-meteo.com/v1/search?name=&count=1&format=json (via curl) | scripts/orion-weather-alert:57-59 | none | Resolve place for the Discord weather alert |
| open-meteo forecast | GET https://api.open-meteo.com/v1/forecast (current + daily, 3 days) via curl | scripts/orion-weather-alert:64-69 | none | Build the weather alert text |
| Discord webhook | POST https://discord.com/api/webhooks/<id>/<token> via /usr/bin/curl, JSON {content, allowed_mentions:{parse:[]}, flags?:4096} | scripts/orion-discord-alert:50-59 | ORION_DISCORD_WEBHOOK_URL in repo .env (gated by ORION_DISCORD_NOTIFICATIONS) | One-way alerts to Nick's private channel |
| Ollama (local) | POST http://127.0.0.1:11434/api/generate model qwen3.5:9b, num_predict 3 | scripts/orion-watches:121-129 | none (localhost) | important-or-skip triage of texts and email, only when plugged in |
| OpenClaw CLI | `~/.openclaw/bin/openclaw message send --channel C --target T --message TEXT` | scripts/orion-notify:231-237 | OpenClaw channel config / ORION_NOTIFY_CHANNEL, ORION_NOTIFY_TARGET | Optional native transport for mission alerts (never configured today; falls back to Discord) |
| Gmail (via orion-gmail-search) | `orion-gmail-search --json --max 10 "in:inbox newer_than:1d -category:promotions ..."` | scripts/orion-watches:131-136 | Gmail OAuth held by orion-gmail-search (not read here) | Important-mail watch |
| CloudKit (Link app) | CKRecord save of LinkCommand and LinkAlert; CKQuerySubscription "orion-link-alerts" | native/OrionLink/App/LinkEngine.swift:188-220; native/OrionMobile/App/CloudLink.swift:88-106 | iCloud account of the device | Phone chat message and iPhone push for outreach |
| Local TTS daemon | unix socket ~/.openclaw/orion-tts.sock | native/Orion/Sources/Orion/TTSClient.swift:160 (per dossier) | none | Speak reach messages aloud |
| Discord Gateway | WebSocket `wss://gateway.discord.gg/?v=10&encoding=json` (or `resume_gateway_url`); ops HELLO/IDENTIFY/RESUME/HEARTBEAT | scripts/orion-remote-bridge:55, 258-340 | `ORION_DISCORD_BOT_TOKEN` (IDENTIFY/RESUME frame) | Receive `MESSAGE_CREATE` events for DMs and @mentions |
| Discord REST | `POST https://discord.com/api/v10/channels/{id}/messages` | scripts/orion-remote-bridge:238-248 | `ORION_DISCORD_BOT_TOKEN` (`Authorization: Bot`) | Post the reply (truncated to 1900 chars) |
| Discord REST | `GET /users/@me`, `/users/@me/guilds`, `/guilds/{id}`, `/users/{owner_id}` | scripts/orion-remote-bridge:589-609 | `ORION_DISCORD_BOT_TOKEN` | `whoami`: find the account id to allowlist |
| OpenClaw gateway (via CLI) | `~/.openclaw/bin/openclaw agent --session-key <key> --timeout 90 [--model m] --thinking <lvl> --json --message-file <file>` | scripts/orion-remote:800-813 | OpenClaw's own config (no token in this file) | One model turn for any non-verb message |
| OpenClaw channel send | `openclaw message send --channel <c> --target <t> --message <text>` | scripts/orion-remote:1757 | OpenClaw channel config | Optional reply push for `poll` when `ORION_REMOTE_REPLY_CHANNEL/TARGET` set |
| CloudKit (via Swift helper, context) | private DB, zone `OrionLink`, record type `LinkCommand` | native/OrionMobile/App/CloudLink.swift:200-224; native/OrionLink/App/LinkEngine.swift:331-428 | iCloud account of the device | Phone-to-Mac transport for chat commands |
| OpenClaw CLI cron | `~/.openclaw/bin/openclaw cron list --all --json`; `cron remove <id> --json` | scripts/lib/orion-automation-removal.mjs:3-30 | OpenClaw's own config | Complete scheduler reading before and after removing the one `orion-auto-<name>` job (section 10.4) |
| OpenClaw gateway (via CLI) | `~/.openclaw/bin/openclaw agent --session-key <key> --json --message <text> --timeout 240` | scripts/orion-approve-resume:23-24 | OpenClaw's own config | After a grant, ask ORION to re-run the approved call (section 10.6) |
| OpenClaw gateway (via CLI) | `~/.openclaw/bin/openclaw agent --session-key agent:main:mission-<id> --timeout 180 --json --message-file <file>` | scripts/orion-mission:419-455 | OpenClaw's own config | One mission "brain" turn per step; prompt saved under the mission's `brain/` dir (section 10.8) |
| Ollama (local) | POST http://127.0.0.1:11434/api/generate, model `gpt-oss:20b`, `stream:false` | scripts/orion-mission:457-466 | none (localhost) | Fallback mission brain when the gateway fails (section 10.8) |
| Ollama (local) | POST http://127.0.0.1:11434/api/generate, model `gpt-oss:20b` | scripts/orion-learn:431-455 (`--judge`) | none (localhost) | Terse sceptical second opinion on each proposal, 300 s timeout (section 7.11) |
| Ollama (local) | `curl http://127.0.0.1:11434/api/generate`, model `gpt-oss:20b` (`MODEL` at :52) | scripts/orion-focus:462 | none (localhost) | Judge a "plead" request in the retired lockdown CLI (section 6.6) |
| Unix socket (Orion.app) | `~/.openclaw/orion-session.sock`, one JSON line request, one JSON line reply, 5 s timeout | scripts/orion-session:62-63, 105-150 | none (local socket) | Focus-session commands: start, pause, finish, arm, release (section 10.8) |
| Basic Memory CLI | `~/.local/bin/basic-memory tool <search-notes|read-note|build-context|write-note|edit-note|recent-activity> --project orion`; `reindex [--project orion --search]` | scripts/orion-brain:32-35, 38-102; scripts/orion-brain-seed:147 | none (local) | Read and write ORION's Obsidian brain (section 10.9) |
| macOS AppleScript | `/usr/bin/osascript -e <script> <handle> <body>` driving Messages.app (iMessage first, SMS fallback), 30 s timeout | scripts/orion-messages-send:237-284 | macOS Automation (TCC) consent for the responsible process | Send one message as Nick (section 7.10) |
| macOS notification | `/usr/bin/osascript -e 'display notification ...'` | scripts/orion-approve-resume:32 | none | Show the outcome of an approved action (section 10.6) |
| macOS Shortcuts | `/usr/bin/shortcuts list`; `shortcuts run <name> --output-path ... [--input-path ...]` | scripts/orion-shortcut:15-43 | none | Run shortcuts named "ORION ..." (section 10.9) |
| sqlite3 (local files) | `/usr/bin/sqlite3 -json "file:<path>?mode=ro&immutable=1" <sql>` on `~/Library/Messages/chat.db` and `AddressBook-v22.abcddb` | scripts/orion-messages:105-132; scripts/orion-messages-send:~110 | Full Disk Access of the responsible process | Read messages and resolve contact names (section 7.8) |
| Canvas LMS | GET `https://{{domain}}/...` through the declarative connector `scripts/connectors/canvas.json` (domain is a setting) | scripts/orion-connect (run), scripts/lib/connect/canvas.mjs | Keychain item named in the spec (`auth.keychain`), read with `/usr/bin/security find-generic-password -a openclaw -s <item> -w` (scripts/orion-connect:51) | Course list and course snapshots (section 7.2, 7.4) |
| TfL | GET `https://api.tfl.gov.uk` via `scripts/connectors/tfl.json` | scripts/orion-connect | none (`auth.type: none`) | Line status and journeys (section 7.2) |
| Gmail (via `gog`) | `gog gmail search ...`, `gog gmail thread get <id> --sanitize-content`, always with `--readonly` and `--gmail-no-send` appended in `gog()` | scripts/lib/gmail-client.mjs:17-67, ~110 | OAuth held by the `gog` CLI | Read-only mail search and fetch (section 7.5) |
| ElevenLabs | POST `https://api.elevenlabs.io/v1/text-to-speech/<voice>?output_format=pcm_24000` | scripts/orion-keys:71 | `ELEVENLABS_API_KEY` (in `.env`, name only) | Key check by synthesising two characters (section 9.6) |
| Deepgram | GET `https://api.deepgram.com/v1/projects` with `Authorization: Token` | scripts/orion-keys:125-128 | `DEEPGRAM_API_KEY` (name only) | Key check (section 9.6) |
| Local TTS daemon | unix socket `~/.openclaw/orion-tts.sock` | scripts/orion-local-tts | none | Thin client per spoken reply (section 10.10) |

### System prompts / instruction text sent to models
| Name | Source (path:line) | Sent to (model/route) | When | Summary |
|---|---|---|---|---|
| Scheduling FORM_PROMPT | plugin/orion-control/src/schedule-flow.ts:64-88 | qwen3.5:9b via Ollama /api/chat (liveScheduleFlow, local-routing.ts:152) | each local-model scheduling request | Fill one form: steps fill_between/plan/clear_after/move/resize/extend/add/drop/skip/swap/tidy/cannot/ask/answer, block refs are real ids B1..., code does the times |
| EXTRACT_PROMPT | plugin/orion-control/src/schedule-flow.ts:92 | qwen3.5:9b via Ollama | when a `plan` step has no item list | Extract where he goes, travel minutes, ordered items with minutes (estimates 15/45/60) |
| standing --polish prompt | scripts/orion-standing:720-725 | gpt-oss:20b via Ollama | only with `--polish` | "Rewrite ... Keep every fact, every name and every number exactly as given. Add nothing." |
| watches triage prompt | scripts/lib/reach/triage.mjs (judge) (not read in detail) | qwen3.5:9b via Ollama | each text/mail check when plugged in | Verdict important/not, 3 tokens |
| SCHEDULING_INSTRUCTIONS / GENERAL_INSTRUCTIONS | plugin/orion-control/src/job-instructions.ts:5,7 | local worker identity text (local-routing.ts) | local route turns | "You are ORION, a personal assistant on Nick's Mac and phone. Nick asks you to change his day. Use the tools to do it..." |
| SCHEDULING.md | plugin/workspace/SCHEDULING.md (130 lines) | main model workspace context | when planning/rescheduling | Durable scheduling rules: to-dos, class wrapper, shrinking, skipping, priority scale, check-ins |
| Importance screen prompt | scripts/lib/reach/triage.mjs:20-25 | local Ollama qwen3.5:9b via scripts/orion-watches:121-129 | per incoming text/email when the gate/mail watch is on and the Mac is plugged in, and sender is not a known person or urgent | "You screen <channel> for Nick, a university student (<context>). Decide if this one is worth interrupting him for RIGHT NOW ... Answer with one word: important or skip." |
| Model-facing reach instructions | plugin/workspace/AGENTS.md:253-254 | main OpenClaw model (workspace file) | every turn that loads AGENTS.md | Tells the model how to call orion-reach, orion-watches, orion-lights; says reach picks the channel and never repeats |
| Weather prohibition | plugin/workspace/AGENTS.md:223 | main OpenClaw model | every turn | Never run orion-weather-alert for a weather question (it messages him) |
| Tool-result reading rules (Not sent, Lights not changed) | plugin/orion-control/src/job-instructions.ts:7 | local-route model | job instructions | Say it did not go through when output says "Not sent:"; only "Lights: sent" counts as done |
| Proactive, morning and reminder texts | scripts/lib/reach/proactive.mjs:17-78; scripts/lib/reach/morning.mjs:146-170; native/Orion/Sources/Orion/AppState.swift:741-750 | not sent to a model (fixed templates spoken/shown to Nick) | per rule | No model composes proactive nudges, the morning briefing or reminder lines |
| CHANNEL_BRIEF (+ briefFor) | scripts/orion-remote:493-546 | `openclaw agent` message file (counts as part of Nick's user turn) | Every non-raw brain turn, phone and Discord (`@phone`/`@discord` lines filtered) | Facts about the channel: it works, verbs handled by transport, approval ids are minted not invented, no words from the authority regex, reply length |
| phoneContext (live facts) | scripts/orion-remote:625-665 | same | Every non-raw phone turn | Open apps, today's calendar with ranks, SCHEDULING.md (12000 chars), check-ins, phone lock, last outreach/question, scheduling how-to for orion-reschedule/orion-tasks/orion-checkin |
| Saved-rules note | scripts/orion-remote:796 | same | When the message stated a standing rule | "Already saved from his message (by the transport, not by you) ..." |
| CHECK_DONE | scripts/orion-remote:686 | same session, escalation model, raw | Reply claimed done with zero tools run | Tell him it is not done, do it now or say so |
| CHECK_CANT | scripts/orion-remote:689 | same | Reply opened with an inability but nothing was looked up | Check TOOLS.md/tool_search, use the tool if one exists |
| CHECK_SILENT | scripts/orion-remote:688 | same | Runtime returned "couldn't generate a response" | Ask for one or two sentences, no tool re-run |
| Marker line | scripts/orion-remote:535 | n/a | End of the brief | `--- Nick's message follows ---` splits context from his words |
| Mission CONTRACT | scripts/orion-mission:550-556 | Mission brain (gateway model, fallback `gpt-oss:20b`) | Every mission turn | "You are ORION running an autonomous mission. You do not have tools here." Reply with ONE JSON object; paths relative to the workspace; runnable commands only node, python3, ls, cat, wc, grep; no installs, no network |
| Mission briefing | scripts/orion-mission:558-575 | Same | Every mission turn | Goal, completion criteria (met/open), plan, verification command, workspace files, last 6 decisions, budget |
| Mission ACTION_MENU | scripts/orion-mission:577-592 | Same | Every mission turn | Exactly one of write_file, run, read_file, note_decision, execute_done, need_human, need_permission, unsafe; write_file replaces the whole file |
| Approval resume message | scripts/orion-approve-resume:20 | The session that asked (gateway agent) | After Nick approves | "[orion-approve] Nick just approved <id> (<summary>). Re-run that exact call now with the same arguments, then tell him in one line what happened." |
| orion-learn judge prompt | scripts/orion-learn:431-455 | Ollama `gpt-oss:20b` | `--judge` only | "You review proposed changes to a voice assistant's instructions. Be terse and sceptical." plus the problem, evidence, diagnosis |
| orion-learn proposed AGENTS.md text | scripts/orion-learn:292-420 (`text` fields) | Not sent; written to docs/planning/learning-proposals.md for Nick to paste | Each run | Drafted rules, for example "Memory is searched with orion-recall, never with the shell" |
| orion-connect how text | scripts/orion-connect:108-127 | The model that calls `orion-connect how` | When ORION is asked to build a connector | The connector JSON format, "GET only", "Read the API's docs first", the Keychain command to tell Nick |
| Focus "plead" judge prompt | scripts/orion-focus:~440-454 | Ollama `gpt-oss:20b` | `orion-focus plead` (retired from the allowlist) | Judge whether a reason is legitimate; "You are his assistant, not his boss. Be short and human, never preachy." |
| Thinking policy (not a prompt, a switch) | scripts/lib/thinking-policy.mjs:13-26 | OpenClaw `--thinking` level | Each turn start | off for talk and one-step commands and all `ollama/` models; low for multi-part changes, whole-day planning, narratives, 35+ words |
| Section 2 (scheduling engine) | none found | n/a | n/a | The `lib/life` modules are pure code; the model-facing text lives in `orion-reschedule` output and plugin prompts (chapters 03, 05) |
| Section 5 (attention) | none found | n/a | n/a | The attention engine sends nothing to a model; it is not wired into the live path (section 5 snapshot note) |

### Memory reads/writes
| Store (path or system) | Op (read/write) | Code (path:line) | What |
|---|---|---|---|
| ~/.openclaw/workspace/memory/DAY.md | write | scripts/orion-remember:71-105; scripts/orion-daily:153-175 | `## Noted` bullets (remember) and the generated ledger summary block (daily) |
| ~/.openclaw/workspace/memory/DAY.md | read | scripts/orion-standing:317-349 | Unresolved commitments from `## Noted` for the evening brief |
| ~/.openclaw/workspace/USER.md | append | scripts/orion-remember:107-114 | Durable facts about Nick |
| ~/Documents/orionBrain (Obsidian vault) | read/write | scripts/orion-note:101-179 | Concept notes with epistemic stamp on body line 2 |
| OpenClaw memory index | read | scripts/orion-recall:51-58 | Semantic search results |
| ~/.openclaw/orion-controlled/task-ledger.jsonl | read; rewrite | scripts/orion-daily:57-209; scripts/orion-why:77-90; scripts/orion-undo:31-36 | Action ledger, archived to archive/ledger-DAY.jsonl.gz |
| ~/.openclaw/orion-controlled/life-config.json | read/write | scripts/lib/life/config.mjs:44-115; scripts/orion-life | Planning preferences, minimums, ranks |
| ~/.openclaw/orion-controlled/reschedule-undo.json | read/write | scripts/lib/life/calendar-write.mjs:59-122 | Last 10 reversible calendar changes |
| ~/.openclaw/orion-controlled/pins.json | read/write | scripts/lib/life/pins.mjs:6-18 | Event ids at times Nick stated |
| ~/.openclaw/orion-controlled/skipped-events.json | read/write | scripts/lib/life/skips.mjs:8-23 | Skipped occurrences on read-only calendars |
| ~/.openclaw/orion-controlled/task-sessions.json | read/write | scripts/orion-tasks:91-100 | Titles of to-dos ORION booked sessions for |
| ~/.openclaw/orion-controlled/checkins.json | read/write | scripts/orion-checkin:31-39 | Open follow-up loops |
| ~/.openclaw/orion-controlled/life-history.jsonl, patterns.json | append/read | scripts/lib/life/history.mjs:13-30 | Planned-vs-actual outcomes and learned patterns |
| ~/.openclaw/orion-controlled/watch.json, night.json, alerts-outbox.jsonl | write | scripts/orion-watch:37-99,195 | Per-day asked/adjusted state, wake/asleep markers, phone alert queue |
| ~/.openclaw/orion-controlled/watches.json | read/write | scripts/orion-watches:30-38 | Weather watches, gate/mail flags, allowed people, seen ids |
| ~/.openclaw/orion-controlled/projects.json | read/write | scripts/orion-project:37-69 | Milestone projects |
| ~/.openclaw/orion-controlled/morning-sent.json, morning-view.json, morning.log | write | scripts/orion-morning:36,72,85-87,98 | Briefing sent flag, screen data, decision log |
| ~/.openclaw/orion-controlled/health-log.json | read | scripts/orion-now:33; orion-watch:58; orion-patterns:13; orion-standing:63 | Sleep, recovery, phone signals |
| ~/.openclaw/orion-controlled/project-agent/queue.json | read/write | scripts/orion-project-queue:23-35 | Project queue state |
| ~/.openclaw/orion-gate/strictness.json | write | scripts/orion-mode:330-345 | Strictness mode state |
| ~/.openclaw/orion-controlled/outreach.jsonl | read+write (append) | scripts/orion-reach:42,62-65; AppDelegate.swift:204-219 | Ledger of every outreach message: id, text, kind, why, channel, reason |
| ~/.openclaw/orion-controlled/outreach-outbox.jsonl | write (append), drained by Link app | scripts/orion-reach:68; LinkEngine.swift:184-220 | Queue for the phone chat thread and push |
| ~/.openclaw/orion-controlled/proactive-sent.json | read+write | scripts/orion-proactive:28,36,83-87 | Which proactive keys were said per day (7 days) |
| ~/.openclaw/orion-controlled/focus-history.jsonl | read | scripts/orion-proactive:51 | Recent focus sessions, focus total today |
| ~/.openclaw/orion-controlled/watches.json | read+write (0600) | scripts/orion-watches:30,36-37 | Watches, important people, gate/mail flags, seen text/mail ids |
| ~/.openclaw/orion-controlled/messages-recent.json | read | scripts/orion-watches:88 | Incoming texts exported by the app |
| ~/.openclaw/orion-controlled/location.json | read | scripts/lib/reach/weather.mjs:11; scripts/orion-weather-alert:29-34 | Home place for weather |
| ~/.openclaw/orion-controlled/local-usage.jsonl | write (append) | scripts/orion-watches:126 | Local-model token usage for watch triage |
| ~/.openclaw/orion-controlled/morning-sent.json, morning.log, morning-view.json | read+write | scripts/orion-morning:36,72,85,98 | Once-a-day briefing record, decision log, screen model |
| ~/.openclaw/orion-controlled/wake-request.json | read+write+delete | scripts/orion-wake:13,22,28; scripts/orion-morning:69 | Manual wake-up alarm request |
| ~/.openclaw/orion-controlled/lights-status.json | read | scripts/orion-lights:20,41-53 | Result of the last LED strip command |
| ~/.openclaw/orion-controlled/cron-delivery.json | read+write | scripts/orion-cron-deliver:58,140-159,234 | Last delivered message per label |
| ~/.openclaw/orion-controlled/cron-delivery-history.jsonl | write (append, 0600) | scripts/orion-cron-deliver:59,173-181 | One outcome row per run |
| ~/.openclaw/orion-controlled/remote.json (+ .lock) | read+write under lock | scripts/orion-notify:52,82-149 | Missions, pending approvals, notify sent/deferred history |
| ~/.openclaw/orion-controlled/eval-mode (marker) | read (mtime) | scripts/lib/eval-mode.mjs:10-14 | Eval run switch, valid 2 hours |
| ~/.openclaw/orion-controlled/remote-audit.jsonl | write/read | scripts/orion-remote:312, 1857-1861 | One JSON line per inbound decision |
| ~/.openclaw/orion-controlled/remote-inbound.json | read/write | scripts/orion-remote:299-311, 1698-1738 | Replay ids (200), rate hits, poll cursor |
| ~/.openclaw/orion-controlled/remote.json | read/write | scripts/orion-remote:259-297 | Mission state and mission approvals (shared with orion-notify) |
| ~/.openclaw/orion-controlled/inbox.jsonl, outbox.jsonl | write/read | scripts/orion-remote:1823, 1835, 1747 | File transport |
| ~/.openclaw/orion-controlled/remote-link.json | write/read | scripts/orion-remote-bridge:168-177, 556 | Discord link health (no content) |
| ~/.openclaw/orion-controlled/lock.json | read | scripts/orion-remote:357-360 | LOCK ORION flag |
| ~/.openclaw/workspace/SCHEDULING.md | read | scripts/orion-remote:633 | Scheduling preferences injected into phone prompt |
| scripts/lib/life/config.mjs (setMinimum) | write | scripts/orion-remote:759-763 | Scheduling minimums from stated rules |
| USER.md via `orion-remember --user` | write | scripts/orion-remote:783-785 | Standing rule in his own words, loaded by every session |
| ~/Documents/orionBrain/20 Areas/Me/Learned about Nick.md | write | scripts/orion-remote:772-779 | Basic Memory vault running note of rules |
| ~/.openclaw/orion-controlled/outreach.jsonl, watch.json, checkins.json | read | scripts/orion-remote:587-623 | Context lines for the phone prompt |
| ~/.openclaw/agents/main/sessions/*.jsonl | read | scripts/lib/audit/chat-log.mjs:37-57 (via scripts/orion-log-audit) | Transcript analysis |
| ~/.openclaw/orion-controlled/pins.json, task-sessions.json, life-config.json, life-history.jsonl, patterns.json | read/write | scripts/lib/life/*.mjs (section 2.5) | Data on disk for the scheduling engine; see section 2.5 for the module-by-file table |
| ~/.openclaw/orion-controlled/attention queue and today feed (paths passed by `--queue` and `--feed`) | read/write | scripts/lib/attention/store.mjs, today-feed.mjs; scripts/orion-attention-collect | Queue store and Today feed; corrupt queue is fatal, corrupt source only an outage (section 5.11, 5.16) |
| ~/.openclaw/orion-controlled/ontask-state.json | read/write | scripts/lib/focus/state.mjs:12; scripts/orion-ontask, orion-ontask-watch | On-task ladder, allow list and log; `ORION_FOCUS_STATE` redirects (section 6.4) |
| ~/.openclaw/orion-controlled/focus-state.json, focus-history.jsonl | write by Orion.app; read by script | scripts/orion-session:75-80 (history read) | Focus session state is owned by the app; the CLI only reads history for `recover` and `today` (section 10.8) |
| ~/.openclaw/orion-controlled/focus-activity.json, focus-phone.json, alerts-outbox.jsonl | read/write | scripts/orion-ontask-watch; scripts/lib/focus/phone-lists.mjs | Activity sample, phone directive, queued check-in text (section 6 state files) |
| ~/.openclaw/orion-controlled/health-log.json | read | scripts/orion-health:12; scripts/orion-phone-time:17 | Sleep, recovery, tracking, phone Screen Time report (`phoneScreen`) |
| ~/.openclaw/orion-controlled/finance-summary.json | read | scripts/orion-finance:13 | Bank summary written by the app after each refresh |
| ~/Library/Messages/chat.db; AddressBook-v22.abcddb | read (immutable, read-only) | scripts/orion-messages:58, 154-206 | Message history and contact names |
| ~/.openclaw/orion-connectors/* and `ORION_CONNECTORS_DIR` | read/write | scripts/orion-connect:29; scripts/orion-connect-admin:13 | User-built connector specs and the writes-allowed switch (section 7.2, 7.3) |
| ~/Documents/orionBrain (Obsidian vault via Basic Memory, project `orion`) | read/write | scripts/orion-brain:38-102 (`learn` appends `- [category] fact (date)` under `## Learned`, folder `20 Areas/Learned`) | ORION's long-term facts about Nick |
| ~/Documents/orionBrain/90 System/ORION Manual/*.md | write (replaces all `.md` first) | scripts/orion-brain-manual:76-84 | Generated manual notes, one per workspace-file section |
| ~/Documents/orionBrain seeded notes (`seeded: true`) | write | scripts/orion-brain-seed:28-47 | Re-seeded from USER.md, SCHEDULING.md, life-config, classes, projects, daily memory; notes without the marker are never touched |
| ~/.openclaw/orion-controlled/canvas-backups | write | scripts/orion-brain:57 (`canvas-refresh --apply`) | Backups of course notes before a Canvas refresh |
| ~/.openclaw/workspace/skills/<name>/ | write | scripts/orion-skill (writes only here; keeps previous versions; `disable` renames) | Skills ORION authors for himself |
| ~/.openclaw/orion-gate/approvals/tickets, grants | read/write | scripts/orion-approve:48-55, 130; scripts/orion-waiting | Approval tickets and human-only grants |
| ~/.openclaw/orion-controlled/missions/<id>/ (mission.json, .bak, journal.jsonl, workspace/, brain/) | read/write | scripts/orion-mission:79, 160-300 | Durable mission state, jailed workspace, saved prompts |
| ~/.openclaw/orion-controlled/automations/{proposed,installed,transactions,runtime,history}/ | read/write | scripts/orion-automation*, scripts/lib/orion-automation-*.mjs (section 10.4 data table) | Automation records, quotas, dispatch state, history rows |
| docs/planning/learning-proposals.md | write | scripts/orion-learn:37, 500 | Proposals only; nothing applied |
| ~/.openclaw/orion-controlled/eval-mode (marker file) | read | scripts/lib/eval-mode.mjs:10-15 | Senders refuse while the marker is under 2 hours old |
| ~/.openclaw/agents/main/sessions/*.jsonl, *.trajectory.jsonl | read | scripts/orion-learn:34; scripts/orion-usage:21 | Session history for learning proposals and token/cost usage |

### Tool calls
| Tool / CLI | Defined at (path:line) | Who calls it | Args | Side effects / gate |
|---|---|---|---|---|
| orion-reschedule | scripts/orion-reschedule:1-42 | model exec (allowlist); schedule flow; Mac app; phone link | see 3.2 table (late, busy, overrun, now, add, fill, day, tidy, clear, drop, extend, resize, rename, move, swap, minimums, early, skip, show, undo) | Calendar writes; refused if day rules break; lock; undo |
| orion-tasks | scripts/orion-tasks:2-24 | model exec; orion-watch; Mac console | list, add, set, plan, sweep, sub | Reminders writes; books via orion-reschedule |
| orion-agenda | scripts/orion-agenda:16-21 | model exec; orion-standing; plugin prep/automation | today, upcoming, deadlines, tasks, day | Read-only |
| orion-agenda-change | scripts/orion-agenda-change:160 | plugin typed actions (changeCalendar, executors.ts:4213-4263) | add, remove-title, task-add, task-done, tasks-sweep | Calendar/Reminders writes; remove needs approval (catalog.ts:2839) |
| calendar_event_add / calendar_event_remove / apple_reminder_add / apple_reminder_complete | plugin/orion-control/src/catalog.ts:2808-2900 | model via orion_task_run | title, start, minutes / title / title, due / title | add: no approval; remove: approval required, not reversible |
| orion-plan-study | scripts/orion-plan-study:1-9 | model exec | "<request>" [--book] | --book writes study blocks |
| orion-now / orion-patterns / orion-life / orion-waiting | scripts/orion-now:1-8, orion-patterns:1-5, orion-life:1-7, orion-waiting:1-4 | model exec | see 3.6 | orion-life writes config |
| orion-checkin | scripts/orion-checkin:1-16 | model exec; phone link; app | add, started, done, defer, cancel, list, tick | Writes checkins.json; phone notifications |
| orion-watch / orion-watches | scripts/orion-watch:1-15; scripts/orion-watches:1-18 | Mac app (tick); model exec | tick, status; add/list/remove/people/gate/mail/tick | Alerts, may write Calendar (short night) |
| orion-standing | scripts/orion-standing:37-44 | cron; model exec; automations | morning, evening, check, auto; --now --every --explain --force --polish --notify | Prints; optional orion-notify |
| orion-daily | scripts/orion-daily:16-19 | cron; model exec | [DAY] [--today] | Writes memory, archives ledger |
| orion-project / orion-project-run | scripts/orion-project:25-29; scripts/orion-project-run:5-10 | model exec | see 3.9 | project-run starts local-model runs, never --enable |
| orion-remember / orion-recall / orion-note | scripts/orion-remember:17-18; orion-recall:20-21; orion-note:33-37 | model exec | see 3.10 | Memory writes (append-only) / reads |
| orion-reach | scripts/orion-reach | orion-proactive, orion-watches, orion-morning, Swift announceReminder (AppState.swift:752), main model via exec | "<msg>" --kind --why --urgent --silent --channel --loud --listen --dry-run --json | Messages Nick; dedupe 2 h, 6/hour; eval refusal exit 0 |
| orion-proactive | scripts/orion-proactive | LifeWatch.swift:48 (every 5 min) | tick [--dry-run] / status | Calls orion-reach; writes proactive-sent.json |
| orion-presence | scripts/orion-presence | human/debug | [--json] | Read-only |
| orion-watches | scripts/orion-watches | LifeWatch.swift (every 5 min), model via exec | add weather / list / remove / people / gate / mail / tick | Calls orion-reach; may call local model |
| orion-morning | scripts/orion-morning | Link app on phone wake signal | signal / preview / show / status | orion-lights, orion-reach --loud, opens orion://morning-screen |
| orion-lights | scripts/orion-lights | orion-morning, model via exec | on/off/brightness/color/scan | orion://lights -> Bluetooth LED strip |
| orion-wake | scripts/orion-wake | model via exec | HH:MM / clear / none | Writes wake-request.json; phone sets alarm |
| orion-notify | scripts/orion-notify | orion-standing --notify, model | started/milestone/decision/blocked/complete/flush/status | Discord via orion-discord-alert; writes remote.json |
| orion-discord-alert | scripts/orion-discord-alert | orion-cron-deliver, orion-notify, orion-weather-alert, model (listed in plugin/orion-control/src/exec-routing.ts:39) | "<message>" | Posts to Discord; eval guard; needs ORION_DISCORD_NOTIFICATIONS=true |
| orion-weather-alert | scripts/orion-weather-alert | cron/human (inferred); model told not to run it | [place] | Sends weather to Discord |
| orion-cron-deliver | scripts/orion-cron-deliver | OpenClaw cron jobs | --label --match --min-interval-minutes -- cmd | Forwards to Discord with filters |
| orion-login-item | scripts/orion-login-item | human | [--remove|--status] | Edits Login Items |
| orion://reach, orion://lights, orion://morning-screen | native/Orion/Sources/Orion/AppDelegate.swift:172-188 | orion-reach, orion-lights, orion-morning via /usr/bin/open -g | id= / do=,brightness=,color= | Mac app speaks/shows, drives BLE strip, shows morning screen |
| orion-remote handle | scripts/orion-remote:1825-1833 | OrionLink CommandRunner (phone), orion-remote-bridge (Discord), orion-eval-run, orion-eval-schedule, model via exec (listed in plugin/workspace/TOOLS.md:72) | `--from --id --at --mode -- <text>` | Guards, model turn, handlers; model/`local` cannot approve |
| orion-remote inject / poll / audit | scripts/orion-remote:1808-1861 | humans, tests | `inject "<msg>" [--from local\|orion] [--to]`, `poll`, `audit [n]` | File queue; audit reads log |
| orion-remote-bridge status/whoami/probe/run | scripts/orion-remote-bridge:562-615 | launchd (`run`), human | none | Network to Discord; writes remote-link.json |
| orion-remote-install | scripts/orion-remote-install:45-52 | human | `--status`, `--remove`, `-h` | Copies code, writes plist, restarts bridge |
| orion-project-agent | scripts/orion-remote:1349-1475 | orion-remote `agent` verb | `[--project <id>] status\|pause\|stop\|exterminate\|resume` | Sets halt flags on the development run; 12 s timeout |
| orion-mission resume / abort | scripts/orion-remote:1070, 1086 | `resume`, `cancel` verbs | `resume <id>`; `abort <id> "cancelled remotely by Nick"` | Starts/aborts a mission runner |
| approvals.js grant/deny | scripts/orion-remote:1138-1148 | `approve`/`deny` verbs for `A-xxxx` ids | `grant(paths, id, "discord:<who>")` | Releases a gated action; refused for `local`/`orion` |
| orion-reschedule minimums | scripts/orion-remote:765 | saveStandingRules | `minimums` | Re-applies minimums to today's plan (calendar write possible) |
| orion-remember --user | scripts/orion-remote:784 | saveStandingRules | `--user "Standing rule (...)"` | Writes USER.md |
| orion-phone-time status | scripts/orion-remote:611 | phoneContext | `status` | Reads phone lock state |
| pmset / uptime / df / ps | scripts/orion-remote:934-936, 961 | device, apps verbs | `-g batt`; none; `-k /`; `-Ao comm=` | Read-only |
| orion-log-audit | scripts/orion-log-audit:1-60 | human | `--dir --archive --since --include-evals --json --out` | Reads transcripts; writes only `--out` |
| orion-messages | scripts/orion-messages:11-17 | model via the catalog's messages-read action | recent, from, search, chats, whoami, contacts-status | Read-only sqlite; needs Full Disk Access; no send |
| orion-messages-send | scripts/orion-messages-send:3-6 | plugin action `messages_send` after approval hash | [--dry-run] "<recipient>" "<message>" | Sends a real iMessage/SMS; refuses secrets, ambiguity, over 2000 chars; blocked in eval mode |
| orion-finance | scripts/orion-finance:5-8 | model exec | (none), recent, --json | Read-only |
| orion-health | scripts/orion-health:5-6 | model exec | (none), --json | Read-only |
| orion-learn | scripts/orion-learn:21-26 | model (allowlisted) or human; no cron caller found | --days N, --last N, --dry-run, --verbose, --judge | Writes only docs/planning/learning-proposals.md |
| orion-gmail-search / orion-gmail-latest | scripts/orion-gmail-search; scripts/orion-gmail-latest | model exec | query, --max N, --full, --json | Read-only Gmail via `gog` |
| orion-connect / orion-connect-admin | scripts/orion-connect; scripts/orion-connect-admin | model exec / Nick only | list, show, run <name> <op> k=v, create, set, how | GET only; admin deletes specs and flips the writes switch |
| orion-attention / orion-attention-collect | scripts/orion-attention; scripts/orion-attention-collect | human (not wired into the live path) | --queue, --feed, --calendar-json, --dry-run | Writes queue and feed files unless --dry-run |
| orion-ontask | scripts/orion-ontask:2-29 | model exec; Swift watcher | status, snooze, allow, wrong, act | Intrusive actions are consent-gated; never starts or stops a session |
| orion-ontask-watch | scripts/orion-ontask-watch:17-27 | Swift `ScheduleFocusWatcher` every 30 s | (none) | May call `orion-ontask act ...` |
| orion-lock | scripts/orion-lock:305-308 | Nick in a terminal; also on the exec allowlist (model) | lock (default), status, release | Drops the profile to restricted_read_only, disables cron jobs, clears approvals/chat and grants; `release` is deliberately not an unlock |
| orion-phone-time | scripts/orion-phone-time:2-4 | model exec | status, grant <minutes|HH:MM> --because "<reason>", revoke | Reads the phone's report; grant (max 60 min) writes `screen-grant.json` |
| orion-waiting | scripts/orion-waiting | model exec | (none) | Read-only list of pending approvals |
| orion-session | scripts/orion-session:12-37 | model exec (allowlisted); Nick | status, start, recover, today, pause, resume, skip, shorten, finish, abandon, preflight, arm, release | Socket to Orion.app; `release` is the always-works escape |
| orion-mission | scripts/orion-mission:57-63 | model exec (allowlisted) | start, run, step, status, list, resume, abort | Jailed workspace; gateway turns cost money (budget 0.50 USD default) |
| orion-brain | scripts/orion-brain:9-18 | model exec (allowlisted) | search, read, context, learn, recent, canvas-courses, canvas-refresh [--apply] | `learn` and `--apply` write the vault |
| orion-brain-seed / orion-brain-manual | scripts/orion-brain-seed:2-17; scripts/orion-brain-manual:2-17 | human | --dry-run | Rewrite seeded notes / replace all generated manual notes |
| orion-approve | scripts/orion-approve:34-42 | Nick only (absent from exec allowlist) | (list), <id>, deny <id>, --json, revoke-chat, <id> --chat | Writes human-only grants |
| orion-approve-resume | scripts/orion-approve-resume:3-10 | `orion-approve` (detached) | <id> <summary> [session] | One gateway turn plus a notification |
| orion-skill | scripts/orion-skill:~40-44 | model exec (allowlisted) | list, show <name>, write <name> --description --body, disable <name> | Writes only under ~/.openclaw/workspace/skills/ |
| orion-shortcut | scripts/orion-shortcut:3-5 | model exec (allowlisted) | list, run "<ORION ...>" [text] | Runs only shortcuts whose names start with "ORION " |
| orion-computer | scripts/orion-computer:83-140 | plugin executor only | observe, capture, click, type, key | After catalog, taint and approval gates; not on raw allowlist |
| orion-selfdev-policy | scripts/lib/orion-selfdev-policy.mjs:17-18 | orion-code | surfaces, check <path>... | Reads the installed plugin's forbidden surfaces |
| orion-forge | scripts/orion-forge | Human | apply <path> <content-file> [msg], revert, status | Edits, builds, installs and rolls back Swift sources (chapter 09) |
| orion-code | scripts/orion-code | Human | run, queue, status | Offline coder in a git worktree (chapter 09) |
| orion-agent | scripts/orion-agent:5-14 | Human | doctor, plan, init, run, status, brief, resolve, bench | Enablement gate in agentic-config.json (chapter 09) |
| orion-usage / orion-costs / orion-budget | scripts/orion-usage; scripts/orion-costs; scripts/orion-budget | human (orion-usage also the Mac app's usage view); no cron caller found (inferred) | --json, --days, --file | Read-only reports (section 9.5) |
| orion-keys | scripts/orion-keys | Nick | (status), --check | Edits .env keys; names only |
| orion-bench | scripts/orion-bench:19 | human | --live (costs money) | Memory-recall benchmark |
| orion-probe-plugin / orion-probe-tools | scripts/orion-probe-plugin; scripts/orion-probe-tools | model exec (allowlisted) | (none) | Diagnostics against the gateway |

### Config flags & env vars
| Name | Where read (path:line) | Default | Effect |
|---|---|---|---|
| ORION_RESCHEDULE_NOW | scripts/lib/life/bridge-path.mjs:30 | real clock | Fake "now" for tests |
| ORION_RESCHEDULE_UNDO | scripts/lib/life/calendar-write.mjs:10 | ~/.openclaw/orion-controlled/reschedule-undo.json (eval- prefix in sandbox) | Undo journal path |
| ORION_RESCHEDULE_PINS | scripts/lib/life/pins.mjs:6 | .../pins.json | Pins path |
| ORION_BRIDGE_BIN | scripts/lib/life/bridge-path.mjs:24,39 | none | Replace the bridge binary (tests); beats sandbox |
| ORION_SANDBOX_CALENDAR | scripts/lib/life/bridge-path.mjs:16 | .../eval-calendar.json | Sandbox calendar for evals |
| ORION_EVAL_MARKER | scripts/lib/eval-mode.mjs:10 | .../eval-mode (valid < 2 h old) | Turns on evaluation mode; senders say "not sent" |
| ORION_SKIPS_FILE | scripts/lib/life/skips.mjs:8 | .../skipped-events.json | Skip list path |
| ORION_LIFE_CONFIG | scripts/lib/life/config.mjs:9 | .../life-config.json | Planning config path |
| ORION_LIFE_HISTORY / ORION_PATTERNS_FILE | scripts/lib/life/history.mjs:13-14 | life-history.jsonl / patterns.json | History paths |
| ORION_TASK_LEDGER | scripts/orion-tasks:93 | .../task-sessions.json | Booked-to-do ledger |
| ORION_CHECKIN_FILE | scripts/orion-checkin:31 | .../checkins.json | Check-in store |
| ORION_WATCH_FILE, ORION_HEALTH_LOG | scripts/orion-watch:37,58 | watch.json, health-log.json | State and health inputs |
| ORION_CONTROLLED_DIR | scripts/orion-morning:35; scripts/orion-watches:29 | ~/.openclaw/orion-controlled | State directory |
| ORION_STANDING_AGENDA | scripts/orion-standing:62 | scripts/orion-agenda | Test seam: different agenda program |
| ORION_NOW | scripts/orion-quick:18 | real clock | Test clock |
| ORION_FOCUS_HISTORY | scripts/orion-quick:35 | .../focus-history.jsonl | Focus history path |
| ORION_LEDGER | scripts/orion-undo:25 | .../task-ledger.jsonl | Ledger path |
| ORION_PROJECT_AGENT_ROOT, ORION_PROJECTS_BIN, ORION_QUEUE_POLL_MS | scripts/orion-project-queue:23-26 | project-agent dir; orion-projects; 30000 ms | Queue paths and poll interval |
| ORION_<NAME>_BIN | scripts/orion-project-run:22 | scripts/<name> | Override child binaries |
| ORION_LAUNCH_REVISION | scripts/orion-projects:111,136 | "new" | Run revision handed to serve |
| ORION_EXTERMINATE_GRACE_SECONDS | scripts/orion-project-agent:140 | 20 (1-300) | Grace before killing a supervisor |
| life-config keys: commuteMinutes, bufferMinutes, homeGapMinutes, readyMinutes, freeMinutesKept, minimums, ranks, autoShrink, todoList, sweepLists, ignoreTitles, usualWake, bedtime, sideProjectMinutes, gymDays | scripts/lib/life/config.mjs:11-36 | live values: commute 45, buffer 5, homeGap 150, ready 105, minimums nap 75 / side project 60, rank gym high | Planner behaviour |
| exec allowlist (security allowlist, ask off, askFallback deny) | ~/.openclaw/exec-approvals.json (agents.main) | per script path | Which CLIs the model may run |
| Quiet hours 23:00-08:00, hours 8/21, imminent 120 min | scripts/orion-standing:66-76 | constants | Standing-order timing |
| ORION_CONTROLLED_DIR | scripts/orion-reach:38; scripts/orion-proactive:27; scripts/orion-watches:29; scripts/orion-morning:35; scripts/orion-lights:20 | ~/.openclaw/orion-controlled | State directory (note orion-wake, orion-notify, orion-cron-deliver ignore it) |
| ORION_EVAL_MARKER | scripts/lib/eval-mode.mjs:10 | ~/.openclaw/orion-controlled/eval-mode | Path of the eval-mode marker file (on for 2 h after mtime) |
| ORION_BRIDGE_BIN | scripts/lib/life/bridge-path.mjs:23-26 | unset | Test seam; makes sandbox() null |
| ORION_ENV_PATH | scripts/orion-discord-alert:16 | <repo>/.env | Where the Discord settings are read |
| ORION_DISCORD_NOTIFICATIONS (in .env) | scripts/orion-discord-alert:38 | false in .env.example | Must be "true" for any Discord alert |
| ORION_DISCORD_WEBHOOK_URL (in .env) | scripts/orion-discord-alert:37 | empty | Webhook URL; must match discord.com/api/webhooks pattern |
| ORION_DISCORD_SILENT | scripts/orion-discord-alert:48 | unset | "1" adds flag 4096 (no phone notification) |
| ORION_NOTIFY_CHANNEL, ORION_NOTIFY_TARGET | scripts/orion-notify:205-206 | unset | Force the openclaw message send transport |
| IDLE_AWAY_SECONDS (constant) | scripts/lib/reach/route.mjs:6 | 300 | Idle time at which Nick counts as away from the Mac |
| allowed(): windowMs, perHour | scripts/lib/reach/route.mjs:33 | 2 h, 6 | Dedupe window and hourly cap for orion-reach |
| GLOBAL_HOURLY_CAP, DEDUPE_MS, QUIET_FROM/UNTIL | scripts/orion-notify:68-71 | 6, 30 min, 23, 8 | orion-notify limits |
| MAX_BODY, DEFAULT_MIN_INTERVAL_MINUTES | scripts/orion-cron-deliver:62-63 | 1200, 10 | cron delivery caps |
| LifeWatch every | native/Orion/Sources/Orion/LifeWatch.swift:20 | 300 s | How often the nudge clock fires |
| default bed / wake | scripts/lib/reach/proactive.mjs:22 | 23:45 / 07:45 | Used when orion-now gives none |
| morning gate constants | scripts/lib/reach/morning.mjs:7-11 | 04:00, 13:00, 45 min, 20 min | Earliest/latest morning, before-alarm slack, stale signal |
| watches.gate / watches.mail | scripts/orion-watches:36 | gate false, mail true | Text gate and important-mail alerts |
| ORION_REMOTE_ALLOW | scripts/orion-remote:191; scripts/orion-remote-bridge:137 | `local` | Allowed sender names (Discord ids, `phone`) |
| ORION_DISCORD_BOT_TOKEN | scripts/orion-remote-bridge:111 | none | Bridge login credential |
| ORION_DEVICE_ID | scripts/orion-remote:163 | hostname | Device routing id |
| ORION_BRAIN_SESSION | scripts/orion-remote:91 | `orion-app-v2` | OpenClaw session key |
| ORION_BRAIN_MODEL | scripts/orion-remote:804 | unset | `--model` for the turn |
| ORION_BRAIN_THINKING | scripts/orion-remote:810 | per-message policy | `--thinking` level |
| ORION_BRAIN_BIN | scripts/orion-remote:95 | `~/.openclaw/bin/openclaw` | Test seam for the model binary |
| ORION_ESCALATION_MODEL | scripts/orion-remote:700 | `anthropic/claude-sonnet-5` | Model for truth-check re-ask; `off` disables |
| ORION_REMOTE_MISSION_BIN | scripts/orion-remote:64 | `scripts/orion-mission` | Test seam |
| ORION_REPO | scripts/orion-remote:1350 | checkout / `~/Desktop/ORION` | Where to find orion-project-agent |
| ORION_REMOTE_REPLY_CHANNEL / ORION_REMOTE_REPLY_TARGET | scripts/orion-remote:1755 | unset | Optional `poll` reply push |
| NODE_TLS_REJECT_UNAUTHORIZED | scripts/orion-remote-bridge:585 | unset | `0` makes the bridge refuse to run |
| `--from --to --id --at --mode` flags | scripts/orion-remote:1789 | from=`local` | Sender, device, envelope id, send time, chat/command mode |
| MAX_ENVELOPE_AGE_MS / RATE_CAP / SEEN_KEPT / MAX_BRAIN_BYTES / BRAIN_TIMEOUT_S | scripts/orion-remote:162, 144, 145, 128, 96 | 10 min / 40 / 200 / 4000 / 90 | Freshness, rate limit, replay memory, size cap, brain timeout |
| INTENTS | scripts/orion-remote-bridge:71 | GUILD_MESSAGES, DIRECT_MESSAGES, MESSAGE_CONTENT | Discord gateway intents |
| Backoff/rotation constants | scripts/orion-remote-bridge:81-88 | 2 s base, 300 s cap, 12 h rotate | Reconnect policy |
| ORION_PATTERNS_FILE | scripts/lib/life/history.mjs:14 | patterns.json under orion-controlled | Redirect the lateness-patterns file for tests |
| ORION_CONTROLLED_DIR | scripts/orion-phone-time:16 (also orion-morning:35, orion-lights:20) | ~/.openclaw/orion-controlled | Root for state files |
| ORION_HEALTH_LOG | scripts/orion-phone-time:17; scripts/orion-watch:58; scripts/orion-log:15 | health-log.json under orion-controlled | Redirect the health log for tests |
| ORION_NOW | scripts/orion-phone-time:24; scripts/orion-usage:24 | real clock | Fake "now" for tests |
| ORION_FOCUS_STATE | scripts/lib/focus/state.mjs:12 | ontask-state.json under orion-controlled | Redirect on-task state |
| ORION_REAUTH_BIN | scripts/lib/orion-reauth.mjs:11 | the real authenticator | Tests name a stand-in so no real prompt appears |
| ORION_CONNECTORS_DIR | scripts/orion-connect:29; scripts/orion-connect-admin:13 | ~/.openclaw/orion-connectors | Where connector specs live |
| ORION_FINANCE_FILE | scripts/orion-finance:13 | ~/.openclaw/orion-controlled/finance-summary.json | Redirect the bank summary |
| ORION_SESSIONS_DIR, ORION_LOCAL_USAGE, ORION_USAGE_CACHE | scripts/orion-usage:21-23 | ~/.openclaw/agents/main/sessions and defaults | Inputs and cache for usage reporting |
| ORION_OPENCLAW_BIN | scripts/orion-timezone:76 | ~/.openclaw/bin/openclaw | Override the OpenClaw binary |
| ORION_SESSION_SOCKET | scripts/orion-session:62-63 | ~/.openclaw/orion-session.sock | Socket to Orion.app (also deliberately overridden inside automation host checks) |
| ORION_FOCUS_HISTORY | scripts/orion-session:76-77 | ~/.openclaw/orion-controlled/focus-history.jsonl | History file for `recover` and `today` |
| ORION_APPROVE_VIA | scripts/orion-approve:66 | unset (terminal) | `app` records the grant as `<user>@app` |
| ORION_APPROVE_NO_RESUME | scripts/orion-approve:139-149 | unset | Skip spawning `orion-approve-resume` (tests) |
| ORION_WORKSPACE | scripts/orion-brain-manual:22 | ~/.openclaw/workspace | Source of manual sections |
| ORION_BRAIN_VAULT | scripts/orion-brain-seed:24; scripts/orion-brain-manual:23 | ~/Documents/orionBrain | Vault root |
| ORION_EVAL_MARKER | scripts/lib/eval-mode.mjs:10 | ~/.openclaw/orion-controlled/eval-mode | Marker path for evaluation mode |
| --blocks, --focus, --rest, --minutes, --until, --sequence, --from-phase, --elapsed, --clips, --dry-run, --json | scripts/orion-session:91-313 (flag helper at :91) | blocks 3, focus 50, rest 10 | Focus session shape; `--sequence` cannot combine with the others |
| --steps, --minutes, --usd, --run | scripts/orion-mission:57-63; DEFAULTS at :86 | 40 steps, 30 min, 0.50 USD | Mission budgets; each exhausted budget is a terminal state |
| MAX_FIX_ROUNDS, CMD_TIMEOUT_MS, LOCK_STALE_MS, BRAIN_TIMEOUT_S, MAX_FILE_BYTES | scripts/orion-mission:87-91 | 4, 60 s, 5 min, 180 s, 256 KiB | Mission constants (not env vars) |
| MAX_LENGTH | scripts/orion-messages-send:48 | 2000 | Longest message the sender accepts |
| `--days`, `--last`, `--dry-run`, `--verbose`, `--judge` | scripts/orion-learn:40-59 | all off | Window and mode for learning proposals |
| enabled (in agentic-config.json) | scripts/orion-agent (enablement gate) | false | `orion-agent run` refuses unless true |

### Glossary terms
| Term | Meaning |
|---|---|
| Life loop | The plan, remind, observe, adapt cycle: planner CLIs plus tickers that speak first (commit 37c29fd, 2026-09-30) |
| Block | A calendar event as the planner sees it: {id,title,kind,start,end,fixed,source,calendarId} in minutes of the day |
| Wall | Fixed time the planner cannot move: classes, plans with people, blocked windows, new fixed plans |
| Pinned | An ORION block at a time Nick stated; kept by cascades, still movable by explicit command (pins.json) |
| Movable / fixed | Fixed = class, deadline or something with people; movable = ORION's own tagged blocks and things he does alone |
| [orion:kind] tag | Note text on events ORION created, e.g. [orion:study]; marks them movable |
| Cascade / rebuild | Re-laying the remaining movable day in time order after a change instead of evicting one block at a time |
| Shrink (auto-shrink) | Low-priority blocks (breaks, side project, optional) give up time, never below their floor, before anything is dropped |
| Commute walls | Travel time before the first class, after the last, around 2.5 h+ gaps and around plans away from home |
| Spread | How a to-do is spread over days, written in its notes ("2 hours a day", "two 2-hour blocks, Tuesday and Thursday") |
| Task ledger (task-sessions.json) | List of to-do titles ORION has booked sessions for, used to remove sessions of finished to-dos |
| Task ledger (task-ledger.jsonl) | Append-only record of every plugin action, summarised by orion-daily and read by orion-why/orion-undo |
| Check-in | A follow-up loop (waiting, reminded, intervening, active, deferred, done) that escalates reminders to the phone |
| Standing orders | Checks run unprompted by orion-standing; "say only what changed" |
| Blind spot | A source that was unavailable; reported as no access, never as "nothing there" |
| Strictness mode | contained/guarded/open/sovereign: how much ORION must ask; set only by orion-mode |
| Exec allowlist | exec-approvals.json list of full-path programs the model's exec may run |
| Eval / sandbox mode | Marker file that redirects bridge calls to a fake calendar and silences senders |
| Installed copy | Copy of scripts under ~/.openclaw/orion-remote/scripts run by the Swift apps (launchd cannot read ~/Desktop) |
| Outreach / reach | ORION starting the conversation (orion-reach), as opposed to answering Nick |
| Ledger | outreach.jsonl, the append-only record of every reach decision, used for dedupe and by the Mac app |
| Outbox | outreach-outbox.jsonl, the queue the Link app drains into the phone chat and push |
| Channel | One of phone, mac-bubble, mac-voice, hold chosen by chooseChannel |
| hold | Quiet-hours channel meaning wait until morning; unreachable today (bug) |
| mac-bubble | Silent hologram bubble on the Mac (used when he is out) |
| mac-voice | Message spoken aloud on the Mac at a sensible volume |
| Presence | Mac facts (idle, lock, headphones, plugged in, volume) plus out/where/quiet |
| Out | A fixed calendar block or commute window covers right now |
| Key (proactive) | Dedupe key such as bed-wind, gap-N, leave-<minute>, due-<title>-<date>; each said once per day |
| LifeWatch | Swift class in the Mac app that runs orion-watch, orion-watches, orion-proactive every 5 minutes |
| Link app | ORION Link, the Mac-side app that syncs ORION with the iPhone through CloudKit |
| Path A / Path B | Presence-aware reach pipeline vs cron-to-Discord pipeline |
| Eval mode | Marker file (under 2 h old) that makes senders print "Not sent" and exit 0 |
| Gated Focus / text gate | Phone Focus that silences texts; orion-watches gate on reads them and forwards only important ones |
| Briefing | The spoken morning summary triggered by a phone wake signal (unplugged/used/up) |
| Deferred / flush | orion-notify queue for quiet hours and the command that sends it as an overnight digest |
| Envelope | One inbound message as `{id, from, text, at, to?}` with replay id and timestamp |
| Brain | The OpenClaw agent turn reached via `openclaw agent`; "askBrain" in orion-remote |
| Verb / fast path | One of 12 fixed words handled by code, no model |
| Chat mode | `--mode chat`: every message goes to the brain, nothing parsed as a verb |
| LOCK ORION | The panic flag in `lock.json`; blocks all inbound except halts |
| Replay guard | Last 200 envelope ids remembered; repeats are refused silently |
| Gate approval (`A-7F3K`) | Approval id minted by the plugin for a gated action |
| Mission approval (`ap-1a2b3c4d`) | Approval id minted by orion-notify when a mission blocks |
| Truth check | One re-ask on the escalation model when a reply claims done/can't with zero tools run |
| Escalation model | Stronger model used only for the re-ask |
| Standing rule | A rule Nick states ("always", "going forward") saved by the transport, not the model |
| Marker line | `--- Nick's message follows ---`, separating context from his words |
| Installed copy | `~/.openclaw/orion-remote/`, the code launchd and the phone helper really run |
| ORION Link helper | `native/OrionLink` login-item app that polls CloudKit and runs orion-remote for the phone |
| LinkCommand | CloudKit record type carrying a phone message and its reply |
| Presence | online/stale/offline/unknown from heartbeat age (120 s / 300 s) |
| Exterminate | `agent exterminate`: abandon the in-flight model call of the development run now |
| Scheduling engine | The pure modules in `scripts/lib/life/` that plan, move, shrink and journal the day (section 2) |
| Cascade | Re-planning that pushes later blocks after a change, keeping walls and pinned blocks |
| Attention gate | The filter that decides whether a queued item is worth interrupting Nick for; not wired into the live path at the snapshot (section 5) |
| Interruption budget | A cap on how many interruptions the attention engine may spend in a window (section 5.6) |
| Today feed | The ranked list the attention engine writes for the Today view (section 5.10) |
| Escalation ladder | nudge, say, front, quit, lock: one rung per tick during a focus block (section 6.1) |
| Schedule focus vs focus session vs lockdown | Three different things that share the word focus; see the orientation table in section 6 |
| orion-lock | The human off switch that drops ORION's own authority |
| Typed stream / typedstream | The NSArchiver format of `message.attributedBody`; decoded by `imessage-typedstream.mjs` (section 7.9) |
| Responsible process | The process macOS credits for Full Disk Access or Automation consent (Terminal or the OpenClaw gateway), not the script itself |
| Connector spec | A JSON file describing a GET-only API (baseUrl, auth, operations, keep list) that `orion-connect` can run (section 7.1) |
| Eval mode | A marker file younger than 2 hours that makes outbound senders print "Not sent" (section 10.5) |
| Approval ticket / grant | A request for Nick's yes and the human-only record that satisfies it; the grant is a permission slip, ORION must re-run the call (section 10.6) |
| Resume | `orion-approve-resume`: ask ORION to re-run the approved call and notify Nick of the result |
| Mission | An autonomous task with a phase machine PLAN to COMPLETE, a jailed workspace and budgets (section 10.8) |
| canComplete | The mission gate: a passing verification, at least one criterion, and every criterion met |
| Brain | The Obsidian vault `~/Documents/orionBrain`, accessed through Basic Memory project `orion` (section 10.9) |
| Seeded note | A brain note with `seeded: true`; the only kind `orion-brain-seed` rewrites |
| ORION Manual | Generated brain notes under `90 System/ORION Manual/`, one per workspace-file section |
| Client, never an engine | Rule for `orion-session`: only Orion.app writes session state; scripts ask it |
| Request id | UUID on every session command; a repeat reports `duplicate: true` and is success |
| Absent from the allowlist | How `orion-approve`, `orion-automation`, `orion-repair`, `orion-forge` and `orion-incident` stay human-only programs |
