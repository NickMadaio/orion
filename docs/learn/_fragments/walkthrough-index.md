# Fragment index — 10_end_to_end_walkthroughs.md
> Snapshot 6c93032 (2026-10-14). Every row is cited in the main file, which has the context.

### API calls
| Service | Endpoint / method | Called from (path:line) | Auth (by name only) | Purpose |
|---|---|---|---|---|
| OpenClaw gateway (via CLI) | `openclaw agent --session-key S --message M --json --timeout 300 [--model] --thinking L` | `native/Orion/Sources/Orion/GatewayClient.swift:115-151` | CLI holds its own credentials; app passes `GOG_KEYRING_PASSWORD` only | Mac app chat/voice turn |
| OpenClaw gateway (via CLI) | `openclaw agent … --message-file <0600 tmp> --timeout 90` | `scripts/orion-remote` (`askBrainOnce`, ~:790-812) | as above | phone / Discord turn |
| OpenClaw gateway (via CLI) | `openclaw agent --session-key S --json --message "[orion-approve] …" --timeout 240` | `scripts/orion-approve-resume:20-27` | as above | re-run an approved call |
| OpenClaw (CLI) | `openclaw audit --session S --after <ms> --json` | `GatewayClient.swift:330-383` | none needed | progress feed every 3 s |
| Ollama | `POST http://127.0.0.1:11434/api/chat` (qwen3.5:4b-q4_K_M, schema, 8 s) | `plugin/orion-control/src/front-desk.ts:73-103` | none | front-desk move |
| Ollama | `POST /api/chat` (qwen3.5:9b, FORM_PROMPT + intentSchema, 30 s) | `plugin/orion-control/src/local-routing.ts:152-165` | none | scheduling form |
| Ollama | `POST /api/chat` (qwen3.5:9b, HH:MM + label schema, 30 s) | `local-routing.ts:177-186` | none | reminder extraction |
| Ollama | local completion (distraction review, 60 s) | `native/Orion/Sources/Orion/DistractionReasoner.swift:20-30` | none | which open apps are off-task |
| Deepgram | `wss://api.deepgram.com/v2/listen?model=flux-general-en&…` | `native/Orion/Sources/Orion/DeepgramSpeech.swift:224-257`, `native/OrionMobile/Sources/MobileCore/FluxTurns.swift:10-21` | `DEEPGRAM_API_KEY` / Keychain item named in `model-roles.json` | streaming STT |
| ElevenLabs (via TTS daemon) | `https://api.elevenlabs.io` (default base) | `scripts/orion_tts_daemon.py` (cloud engine) | Keychain `ORION ElevenLabs` / `ELEVENLABS_API_KEY` | cloud voice |
| CloudKit | private DB, container `iCloud.com.nickmadaio.orion`, zone `OrionLink`, records `LinkCommand`, `MacState`, `LinkAlert` | `native/OrionMobile/App/CloudLink.swift:50-224`, `native/OrionLink/App/LinkEngine.swift:74-428` | iCloud account + dev-team entitlement | phone ↔ Mac messaging, alerts |
| Discord webhook | POST (allowed_mentions none) | `scripts/orion-discord-alert:37-49` | `ORION_DISCORD_WEBHOOK_URL` in `.env` | cron deliveries |
| OpenClaw message | `openclaw message send --channel/--target` | `scripts/orion-notify:345-376` | gateway | notify transport (falls back to Discord) |
| EventKit (via bridge) | stdin JSON `{id,action,payload}` → `create/move/delete_calendar_event`, `list_upcoming_calendar_events`, `list_incomplete_reminders` | `scripts/lib/life/bridge-path.mjs:36-46` → `native/OrionMacBridge/Sources/OrionMacBridge/Bridge.swift:54-67, 421-470` | macOS Calendar/Reminders TCC | calendar reads/writes |
| Unix socket | `~/.openclaw/orion-session.sock` `{op, requestId, …}` | `scripts/orion-session:61,113-135` → `native/Orion/Sources/SessionService/SessionIPC.swift:470-530` | file mode 0600 | focus session commands |
| Unix socket | `~/.openclaw/orion-tts.sock` `{op:"synth",text,mode:"stream",preempt,provider}` / `{op:"cancel"}` | `native/Orion/Sources/Orion/TTSClient.swift:160,211-217` | none | speech |
| Unix socket | `~/.openclaw/orion-voiceid.sock` `{op:"verify",audio,rate}` | `native/Orion/Sources/Orion/SpeakerVerifier.swift:118-141` | none | speaker verification |
| URL scheme | `orion://reach?id=<id>` via `/usr/bin/open -g` | `scripts/orion-reach:64-66` → `AppDelegate.swift:173-177` | none | deliver outreach on Mac |

### System prompts / instruction text sent to models
| Name | Source (path:line) | Sent to (model/route) | When | Summary |
|---|---|---|---|---|
| App context header | `native/Orion/Sources/Orion/AppState.swift:2098-2112` | gateway model (any) | every Mac turn | focus-session state, enforcement, allowed apps; "Do not claim an app is blocked… unless a tool confirms"; spoken style line for voice |
| Recent outreach prefix | `GatewayClient.swift:99-110` | gateway model | if ORION messaged first in last 6 h | "[ORION context: you messaged him first — …]" |
| SCHEDULING.md prefix | `native/Orion/Sources/Orion/SchedulingMemory.swift:4-11` | gateway model | text matches schedule words | ≤12,000 chars of `~/.openclaw/workspace/SCHEDULING.md` |
| FRONT_DESK_SYSTEM | `plugin/orion-control/src/front-desk-prompt.ts:6` | qwen3.5:4b | every turn when localRouting shadow/on | pick one of answer/tool/escalate/ask/ignore as JSON |
| FORM_PROMPT | `plugin/orion-control/src/schedule-flow.ts:64-89` | qwen3.5:9b | scheduling statement, localRouting on | fill one form of steps with real block ids |
| EXTRACT_PROMPT | `schedule-flow.ts:91` | qwen3.5:9b | `plan` step without items | list where/travel/items |
| Reminder extraction | `local-routing.ts:182` | qwen3.5:9b | REMINDER match | HH:MM + label JSON |
| Reminder exact-call prompt | `local-routing.ts:324-327` | qwen3.5:9b (worker turn) | REMINDER match | "Set Nick's reminder now with ONE orion_task_run call using exactly these arguments" |
| Exact scheduler reply | `local-routing.ts:353-360` | worker | flow done/say | "Reply to Nick with exactly this text and nothing else" |
| Day question | `local-routing.ts:344-347` | worker | scheduling question | answer from read-just-now day list only, no tools |
| Front-desk draft | `local-routing.ts:365-367` | worker | move answer, not a change | send draft if right |
| Job instructions + PRODUCTION_NOTES + LOOK_IT_UP | `job-instructions.ts:5-7`, `local-routing.ts:132,202-208,368-372` | worker | fallback / general | full script paths, one-call recipes, look things up in the brain |
| LOCAL_IDENTITY | `local-routing.ts:188` | worker | all short prompts | one to three spoken sentences, never claim without tool result |
| Retry / HONEST_STOP | `work-check.ts:196-212`, `local-routing.ts:210` | worker or Haiku (revise) | work-check findings | fix what the check found / undo and say plainly |
| orion_task_run description | `plugin/orion-control/src/index.ts:1111-1150` | any model with the tool | tool listing | read `executed`/`confidence`; needs_approval rules |
| Approval waiting note | `index.ts:1034-1040` | model (tool result) | needs_approval | "Tell him the id out loud… You cannot approve it yourself" |
| Approve-resume message | `scripts/orion-approve-resume:20` | gateway model | after a grant | "Re-run that exact call now with the same arguments" |
| Phone context brief | `scripts/orion-remote` (`phoneContext`, `briefFor`) | gateway model | phone/Discord turns | live facts, rules, then `--- Nick's message follows ---` |

### Memory reads/writes (anything that persists knowledge about Nick or the conversation)
| Store (path or system) | Op (read/write) | Code (path:line) | What |
|---|---|---|---|
| `~/.openclaw/orion-controlled/chats/` (ChatStore) | write/read | `AppState.swift:82,112-118`; `LinkEngine.swift:510-518` | chat history shared by Mac and phone |
| `~/.openclaw/agents/main/sessions/*` | read | `native/OrionMobile/Sources/MobileCore/ChatThinking.swift:4-25` | session transcript (thinking blocks, struggle detection) |
| `~/.openclaw/orion-controlled/outreach.jsonl` | write/read | `scripts/orion-reach:62-66`; `GatewayClient.swift:99-110`; `AppDelegate.swift:205-219` | everything ORION said first |
| `~/.openclaw/orion-controlled/outreach-outbox.jsonl` | write/read+truncate | `scripts/orion-reach:68`; `LinkEngine.swift:188-220` | to phone thread/push |
| `~/.openclaw/orion-controlled/alerts-outbox.jsonl` | write/read+truncate | `account-health.ts:168-170`; `LinkEngine.swift:144-180` | phone alerts |
| `~/.openclaw/orion-controlled/proactive-sent.json` | read/write | `scripts/orion-proactive:36-37,83-86` | which nudges were said per day (7 days) |
| `~/.openclaw/orion-controlled/reschedule-undo.json` | write/read | `scripts/lib/life/calendar-write.mjs:92-113` | last 10 schedule changes for undo |
| `~/.openclaw/orion-controlled/reschedule.lock` | create/remove | `scripts/orion-reschedule:151-165` | one change at a time |
| `~/.openclaw/orion-controlled/places.json` | read | `schedule-flow.ts:96-105` | commute minutes per place |
| `~/.openclaw/orion-controlled/local-routing/shadow.jsonl` (+`.trace`) | write | `local-routing.ts:252-263,437-438` | per-turn routing decisions, flow calls, findings |
| `~/.openclaw/orion-controlled/local-routing/acceptance.json` | read | `local-routing.ts:219-229` | gate for `localRouting: on` |
| `~/.openclaw/orion-controlled/reminders.json` | write/read | `executors.ts:2404`; `ReminderService.swift:63-65,111-116` | timers/alarms |
| `~/.openclaw/orion-controlled/task-ledger.jsonl` | write | `controller.ts:144-152` | every orion_task_run record |
| `~/.openclaw/orion-controlled/permission-state.json` | read | `permissions.ts:232-263` | permission profile |
| `~/.openclaw/orion-gate/approvals/{tickets,grants,used}/` | write/read/rename | `approvals.ts:211-322`, `index.ts:995-1023` | approval tickets and grants |
| `~/.openclaw/orion-gate/strictness.json` | read | `index.ts:476-478, 858-874` | strictness delegation |
| `~/.openclaw/orion-controlled/focus-state.json` | write/read | `SessionStore.swift:30-35`; `SessionService.swift:224-232` | live focus session event log |
| `~/.openclaw/orion-controlled/focus-history.jsonl` | append/read | `SessionHistory.swift:31-32`; `scripts/orion-proactive:51` | one row per session, never pruned |
| `~/.openclaw/orion-controlled/remote-inbound.json`, `remote-audit.jsonl` | write | `scripts/orion-remote` (`admitInbound` ~:1697) | replay/rate state, decisions |
| `~/.openclaw/orion-controlled/cron-delivery*.json(l)` | write | `scripts/orion-cron-deliver:173-177,234` | cron delivery outcomes |
| Obsidian brain (`orion-brain search`) | read | `local-routing.ts:141-144` | notes pre-fetched for the worker |
| UserDefaults `link.changeToken`, `link.alertedApprovals`, `link.chatExports` (Mac helper); `link.phoneToken`, `orion.localChat.v1` (phone) | read/write | `LinkEngine.swift:300-316, 331-368`; `CloudLink.swift:129-187` | CloudKit sync position, dedupe |

### Tool calls (tools exposed to a model, or CLIs a model invokes)
| Tool / CLI | Defined at (path:line) | Who calls it | Args | Side effects / gate |
|---|---|---|---|---|
| `orion_task_run` | `plugin/orion-control/src/index.ts:1111-1212` | gateway model | `{graph}` or `{steps:[{action,…args}]}` | profile tiers, provenance, validator, approval grants, ledger |
| action `alarm_set` | `catalog.ts:2570-2589`; exec `executors.ts:2371-2414`; verify `:2853-2869` | via orion_task_run | `at`, `label` | writes reminders.json; no approval |
| action `messages_send` | `catalog.ts:3476-3484` | via orion_task_run | `recipient` (must come from Nick), `body` | approvalRequired; tier only in external_connected |
| other approvalRequired actions | `catalog.ts:1847,1909,1958,2038,2839,3453` | via orion_task_run | — | self_*_authority, email_send, calendar_event_remove, terminal_run |
| `exec` → `scripts/orion-reschedule` | `scripts/orion-reschedule:1-42` (usage) | model (allowlisted), schedule flow (execFile), Mac app | `show --json`, `add`, `move`, `drop`, `skip`, `day --plan`, `undo` … | writes Apple Calendar via bridge; lock; undo journal |
| `exec` → `scripts/orion-session` | `scripts/orion-session:1-48` | model | `start/pause/resume/skip/shorten/finish/abandon/preflight/arm/release` | socket to app only |
| `exec` → `scripts/orion-brain` | `local-routing.ts:132,141` | worker, plugin | `search "<words>"`, read titles | read |
| `scripts/orion-reach` | `scripts/orion-reach:30-90` | orion-proactive, Mac app reminders, model | `"<msg>" --kind --why --urgent --channel --silent` | eval refusal; ≤6/h; outbox/URL |
| `scripts/orion-approve` | `scripts/orion-approve:1-149` | Nick only (terminal, app buttons) | `[id] [--chat] / deny id / --json / revoke-chat` | NOT on exec allowlist; writes grants |
| `scripts/orion-approve-resume` | `scripts/orion-approve-resume:1-32` | spawned by orion-approve | `id summary session` | runs openclaw agent, macOS notification |
| `scripts/orion-remote handle` | `scripts/orion-remote:1512-1639` | ORION Link CommandRunner, Discord bridge | `--from --id --at --mode chat -- text` | sender/age/replay/rate gates; `approve` refuses `local` |
| `scripts/orion-tasks` | `scripts/orion-tasks:36-47` | model | to-do ops | refuses unknown options (`--at`) since b5bf4ab |
| `orion-mac-bridge` | `native/OrionMacBridge/Sources/OrionMacBridge/Bridge.swift:30-170` | life scripts | JSON lines | EventKit, screen, notifications |

### Config flags & env vars
| Name | Where read (path:line) | Default | Effect |
|---|---|---|---|
| `localRouting` (plugin config) | `index.ts:1671-1686`; `local-routing.ts:231-247` | off (absent) | shadow/on local front desk + worker; live "on" |
| `localRoutingTestingUntil` | `local-routing.ts:234-239,284` | none | ≤48 h window where "on" skips acceptance; live 2026-10-14T17:04:46Z |
| `localRoutingScheduleToCloud` | `local-routing.ts:289-292` | false | change requests go to the configured cloud model |
| `localRoutingTrace` | `local-routing.ts:250-253` | false | per-stage trace file |
| `localRoutingLogPath` | `index.ts:1683-1685` | `…/local-routing/shadow.jsonl` | log location |
| `accountHealth`, `accountFailFast` | `index.ts:1660-1669` | on, off | dead-account alert, fail-fast |
| `enableMessagesSendActions`, `enableReminderActions`, … | `index.ts` `configuredTiers` | per flag | which catalog tiers exist |
| `approvalRoot`, `permissionStatePath`, `remindersPath`, `ledgerPath` | `index.ts:472-486, 812, 908-912` | under ~/.openclaw | file locations |
| `agents.defaults.model.primary/fallbacks` (openclaw.json) | gateway | Haiku 4.5; qwen3.5:9b, llama3.2:3b | default model chain |
| `gateway.port` | `GatewayClient.swift:67-76` | 18789 | health probe |
| `GOG_KEYRING_PASSWORD` | `GatewayClient.swift:139-148` | — | passed to agent process (name only) |
| `ORION_APPROVE_VIA` | `scripts/orion-approve:67`; `ApprovalsOverlay.swift:93` | terminal | grant attributed `@app` |
| `ORION_APPROVE_NO_RESUME` | `scripts/orion-approve:133` | unset | skip resume (tests) |
| `ORION_BRAIN_SESSION`, `ORION_BRAIN_MODEL`, `ORION_BRAIN_THINKING`, `ORION_REMOTE_ALLOW` | `CommandRunner.swift:33-57`; `scripts/orion-remote:91-96` | orion-app-v2 | phone turn session/model |
| `ORION_SESSION_SOCKET` | `scripts/orion-session:61` | ~/.openclaw/orion-session.sock | socket path |
| `ORION_FOCUS_STATE` | `SessionStore.swift:37-40` | focus-state.json | test redirect |
| `ORION_RESCHEDULE_NOW`, `ORION_RESCHEDULE_UNDO`, `ORION_BRIDGE_BIN`, `ORION_SANDBOX_CALENDAR` | `bridge-path.mjs:16-34`; `calendar-write.mjs:10-11` | — | eval/test redirects |
| `ORION_CONTROLLED_DIR`, eval-mode marker | `scripts/orion-reach:38`; `scripts/lib/eval-mode.mjs:12-20` | ~/.openclaw/orion-controlled; marker <2 h | real sends refused during evals |
| UserDefaults `OrionSTTProvider`, `OrionTTSProvider`, `OrionWakeWordEnabled`, `OrionWakeSensitivity`, `OrionVoiceEndpointingMs`, `OrionVoiceUtteranceEndMs`, `OrionVoiceAppleFinalGrace`, `OrionSpeakingStallTimeout` | `VoiceProviders.swift:67-124`, `SummonSettings.swift:84-88`, `AdaptiveEndpointModel.swift`, `VoiceTuning.swift:102-117` | apple, local, —, balanced, 900, 1800, 1.2, 12 | voice pipeline |
| UserDefaults `orion.focus.{doNotDisturb,pauseMusic,cameraPresence,quitDistractions,fullBleedBreak}`, `orion.break.*`, `orion.focus.audioSource` | `FocusExtras.swift:20-32,183` | all off | session extras |
| `RemoteViews.answerOnDevice` (constant) | `native/OrionMobile/App/RemoteViews.swift:156` | false | phone never answers on-device |
| `RunTimeouts` constants | `RunTimeouts.swift:54-90` | 300/320/325/360/420 s | turn timeout chain |
| Enforcement policy | `SessionDomain/Enforcement.swift:178-188` | grace 60 s, idle 5 min, nudge 60 s, disengage 6 | drift rules |
| `TICKET_TTL_MS`, `CHAT_GRANT_TTL_MS` | `approvals.ts:125,332` | 15 min, 8 h | approval lifetimes |
| `ReminderService.pollInterval`, `staleAfter` | `ReminderService.swift:48,56` | 2 s, 120 s | reminder firing |
| `IDLE_AWAY_SECONDS`, `allowed()` window/perHour | `scripts/lib/reach/route.mjs:6,33` | 300 s; 2 h, 6 | outreach routing / anti-nag |
| `LATE_NIGHT_UNTIL` | `schedule-flow.ts:213` | 5 | "tomorrow" before 5 AM = today |

### Glossary terms
| Term | Meaning |
|---|---|
| Hop | One hand-off in a trace where data changes shape or process. |
| Session key | OpenClaw conversation id: `orion-app-v2` (Mac default and phone default), `orion-chat-<uuid>`; transcript key `agent:main:<key>`. |
| Generation | `AppState.askGeneration`; a late answer from an older generation is dropped (or kept for "continue" if paused). |
| ReplyOrigin | `.typed` or `.voice`; only voice replies are spoken. |
| Front desk | qwen3.5:4b that picks one move per message (answer/tool/escalate/ask/ignore). |
| Worker | qwen3.5:9b that answers every turn when localRouting is on. |
| Schedule flow | Fixed sequence: read day → 9B fills one form with B-ids → code compiles argv → orion-reschedule runs → code writes reply. |
| B-id | `B1…Bn`, the numbered blocks of the day shown to the 9B; schema enums restrict references to real ids. |
| Work check | `checkWork` at finalize: false claims, asked-instead-of-acting, promised-but-did-not-act, etc. |
| Testing window | `localRoutingTestingUntil`: time-boxed "on" without an acceptance record. |
| Acceptance record | `local-routing/acceptance.json`; ≥20 cases, ≥85 %, ≤20 s median, ≤14 days, required for "on". |
| Provenance | Host-hook record of the authenticated user turn; only source of `trusted_user` inputs. |
| Canonical hash | `hash({action, arguments, workingContext})`; binds an approval to exact arguments. |
| Ticket / grant | Ticket = plugin-minted pending approval (`A-XXXX`, 15 min, nonce). Grant = human-written yes echoing the nonce; spent by rename to `used/`. |
| Single writer | `SessionService`: the only process that writes focus state; scripts are clients over the socket. |
| Effect / acknowledgement | Reconcile-derived side effects with stable ids; acknowledged only after success so crashes don't repeat them. |
| waitingForReturn | Session status when a break ended while Nick was idle; focus doesn't resume until he returns. |
| Outreach | ORION speaking first through `orion-reach`; channels phone / mac-bubble / mac-voice / hold. |
| ORION Link | Separate signed helper app on the Mac that polls CloudKit every 4 s and runs phone commands via `orion-remote`. |
| Installed copy | Scripts under `~/.openclaw/orion-remote/scripts` that the app and helper actually run; can drift from the repo. |
