# 03 — Brain, prompts, memory: fragment index

Source: `docs/learn/03_brain_prompts_memory.md` (snapshot 6c93032, 2026-10-14). Paths relative to repo root unless `~`. No secrets recorded; secrets named by Keychain item only.

### API calls
| Service | Endpoint / method | Called from (path:line) | Auth (by name only) | Purpose |
|---|---|---|---|---|
| OpenClaw gateway (loopback :18789) | `openclaw agent --session-key orion-app-v2 --message … --json --timeout N [--model] --thinking L` | native/Orion/Sources/Orion/GatewayClient.swift:115-134 | gateway token (Keychain item "ORION OpenClaw Gateway") | Mac app turns |
| OpenClaw gateway | `openclaw agent --session-key <BRAIN_SESSION> --message-file <tmp> --json --thinking L [--model]` | scripts/orion-remote:790-826 | same | phone/Discord turns |
| Anthropic (via gateway) | `anthropic/claude-haiku-4-5-20251001` primary; `anthropic/claude-sonnet-5` for truth-check retry | ~/.openclaw/openclaw.json agents.defaults.model; scripts/orion-remote:700 | Keychain item "ORION OpenClaw Anthropic" | main brain |
| Ollama 127.0.0.1:11434 | `/api/chat` (front desk 4B, schedule form 9B) | plugin/orion-control/src/front-desk.ts:56-68; schedule-flow.ts:234-239 | none | local routing |
| Ollama | `/api/generate` warm-up | front-desk.ts:107 | none | keep models warm |
| Ollama | `/api/generate` gpt-oss:20b | native/Orion/Sources/Orion/LocalModel.swift:90-115; scripts/orion-standing:713 | none | local text transforms, notification polish |
| Ollama | `/api/generate` qwen3.5:9b, num_predict 3 | scripts/orion-watches:121-127 | none | watch triage |
| Ollama (embeddings) | `nomic-embed-text` via OpenClaw memorySearch | ~/.openclaw/openclaw.json agents.defaults.memorySearch | none | memory index |
| Basic Memory CLI | `~/.local/bin/basic-memory tool search-notes/read-note/write-note/edit-note/build-context/recent-activity --project orion`; `reindex --project orion --search` | scripts/orion-brain:35,63 | none (local) | Brain read/write |
| Basic Memory MCP | `basic-memory mcp --project orion` (7-tool filter) | ~/.openclaw/openclaw.json mcp.servers.brain | none | configured; per orion-brain:6-7 not delivered to the embedded runner |
| OpenClaw CLI | `openclaw memory search --max-results 12 <q>` | scripts/orion-recall:51-58 | none | recall |
| macOS Keychain | `/usr/bin/security find-generic-password -w -s <item> -a openclaw` | openclaw.json secrets.providers | items: ORION OpenClaw Anthropic / Gateway / Ollama | secret custody |
| OpenClaw cron | `openclaw cron list/disable` | scripts/orion-setup:402; scripts/orion_v2_lock_check.sh:56-67 | none | jobs orion-focus-guard, orion-standing-orders, orion-daily-memory |
| Discord webhook | via `orion-discord-alert` | scripts/orion-cron-deliver | webhook (not named) | cron delivery |

### System prompts / instruction text sent to models
| Name | Source (path:line) | Sent to (model/route) | When | Summary |
|---|---|---|---|---|
| Workspace bootstrap (AGENTS, SOUL, IDENTITY, USER, TOOLS, MEMORY) | ~/.openclaw/workspace/*.md (repo copy plugin/workspace/*.md); order: OpenClaw dist system-prompt-config-*.js:68-76 | Claude (cloud route) | every turn except `continuation-skip` continuations | AGENTS.md truncated 9k+digest 7k+3k (replayed); others whole |
| AGENTS.md | plugin/workspace/AGENTS.md (442 lines, 31,903 chars) | Claude | system prompt | operating rules, scheduling commands, router, memory layers |
| SOUL.md | plugin/workspace/SOUL.md | Claude | system prompt | voice, truth, approvals, skills |
| USER.md | plugin/workspace/USER.md | Claude | system prompt | facts about Nick, priorities |
| MEMORY.md | plugin/workspace/MEMORY.md | Claude | system prompt | lessons about ORION |
| TOOLS.md (generated, live only) | ~/.openclaw/workspace/TOOLS.md (gen by scripts/orion-selfdoc) | Claude | system prompt | capability index |
| IDENTITY.md / HEARTBEAT.md (live only) | ~/.openclaw/workspace/ | Claude | system prompt | identity; empty heartbeat |
| SELF.md, PLAYBOOK.md, SCHEDULING.md | plugin/workspace/ | Claude, on demand (not bootstrap) | when read or pushed | surfaces; service detail; scheduling rules |
| SCHEDULING.md push (phone) | scripts/orion-remote:633 | Claude | every phone turn | first 12,000 chars in user message |
| SCHEDULING.md push (Mac) | native/Orion/Sources/Orion/SchedulingMemory.swift:4-12 | Claude | keyword-matched Mac turns | first 12,000 chars |
| phoneContext live facts | scripts/orion-remote:625-684 | Claude | every phone turn | apps, calendar with ranks, travel, check-ins, phone lock, outreach, reschedule guide |
| CHANNEL_BRIEF | scripts/orion-remote:493-537 | Claude | every remote turn | channel facts, approvals rules (no authority-regex words) |
| savedNote | scripts/orion-remote:796 | Claude | when standing rule saved | tells model it is already saved |
| CHECK_DONE / CHECK_CANT / CHECK_SILENT | scripts/orion-remote:686-690 | Claude Sonnet 5 retry | reply claims done/can't with 0 tools | one re-ask |
| recentOutreach | GatewayClient.swift:99-111; orion-remote | Claude | ORION messaged first in last 6 h | context line |
| Skills index | workspace/skills/*/SKILL.md descriptions; cap openclaw.json skills.limits.maxSkillsPromptChars=7000 | Claude | system prompt | 11 workspace skills + 4 bundled |
| FRONT_DESK_SYSTEM | plugin/orion-control/src/front-desk-prompt.ts:6 | qwen3.5:4b-q4_K_M | each non-internal turn (shadow/on) | 5-move JSON router, 17 tools |
| SCHEDULING_INSTRUCTIONS / BRAIN_INSTRUCTIONS / GENERAL_INSTRUCTIONS | plugin/orion-control/src/job-instructions.ts:5-7 | qwen3.5:9b worker | on | frozen job prompts + shared honesty block |
| LOCAL_IDENTITY, PRODUCTION_NOTES, LOOK_IT_UP, dateLine, brainSnippets | local-routing.ts:188,202-208,132,191-196,135-146 | qwen3.5:9b | on | worker prompt additions |
| Reminder / day read-out / exact-reply / front-desk-draft prompts | local-routing.ts:315-366 | qwen3.5:9b | on | code-built prompts |
| appendContext notes | local-routing.ts:325,355,360 | qwen3.5:9b | on | "[ORION scheduler — already done…]" |
| FIX / retryInstruction | plugin/orion-control/src/work-check.ts:196-212 | qwen3.5:9b retry | work check finds problem | fix instructions |
| HONEST_STOP | local-routing.ts:210 | qwen3.5:9b | 2nd failed pass | undo and report |
| FORM_PROMPT, EXTRACT_PROMPT | plugin/orion-control/src/schedule-flow.ts:64-93 | qwen3.5:9b | scheduling flow | JSON form; where/travel/items |
| Account alert prompt | plugin/orion-control/src/account-health.ts:238-243 | fallback model | primary account dead | exact alert text |
| Personalities tones / conversation modes | plugin/orion-control/src/personalities.ts:104-140; conversation-modes.ts | none (unwired) | never | designed only |
| Thinking policy | scripts/lib/thinking-policy.mjs:6-26; ThinkingPolicy.swift | Claude `--thinking` | every cloud turn | off/low rule |
| Notification polish | scripts/orion-standing:709-735 | gpt-oss:20b | standing orders | rewrite w/ digit guard |
| Brain manual notes | scripts/orion-brain-manual (92 lines) | read on demand | "look it up" | one note per workspace `##` section |

### Memory reads/writes (anything that persists knowledge about Nick or the conversation)
| Store (path or system) | Op (read/write) | Code (path:line) | What |
|---|---|---|---|
| ~/.openclaw/workspace/memory/YYYY-MM-DD.md `## Episodes` | write | plugin/orion-control/src/episodic.ts:111-146; index.ts:1688-1717 | `[auto]` episodes from Nick's turn |
| same file `## Noted` | write | scripts/orion-remember:71-105 | explicit notes (≤600 chars) |
| same file marker block | write | scripts/orion-daily:150-200 | ledger summary, then gzip archive |
| live USER.md | write (append) | scripts/orion-remember:107-113 | `--user` durable facts, standing rules |
| life-config.json | write | scripts/orion-remote:754-789 (setMinimum) | scheduling minimums |
| ~/Documents/orionBrain/20 Areas/Me/Learned about Nick.md | write | scripts/orion-remote:754-789 | `- [rule]` lines |
| orionBrain 20 Areas/Learned/<note>.md | write | scripts/orion-brain:81-97 | `- [cat] fact (date)` under ## Learned |
| orionBrain 50 Concepts/<title>.md | write | scripts/orion-note:~96-175 | provenance-stamped concept notes |
| orionBrain seeded notes | write | scripts/orion-brain-seed | seed from USER/SCHEDULING/calendar/daily |
| orionBrain 90 System/ORION Manual/* | write | scripts/orion-brain-manual:88-91 | generated manual |
| orionBrain 20 Areas/School/Courses/*, 60 Sources/Source Register.md | write | scripts/lib/connect/course-vault.mjs:40-79 | Canvas facts between orion:canvas markers |
| ~/.openclaw/orion-controlled/canvas-backups/ | write | course-vault.mjs; orion-brain:57 | backups before apply |
| orionBrain | read | scripts/orion-brain:73-100 | search/read/context/recent |
| OpenClaw memory index | read | scripts/orion-recall:51-58 | semantic search |
| OpenClaw memory index | write | OpenClaw nightly job (orion-daily-memory); basic-memory reindex (orion-brain:63) | re-index |
| ~/.openclaw/agents/main/sessions/*.jsonl | read | scripts/orion-learn; orion-trace | failure mining; proposals to docs/planning/learning-proposals.md |
| ~/.openclaw/orion-controlled/task-ledger.jsonl | read/rewrite | scripts/orion-daily | summarise and archive |
| ~/.openclaw/orion-controlled/outreach.jsonl | read | scripts/orion-remote:~590; GatewayClient.swift:99 | what ORION said first |
| life-config.json | read | SchedulingMemory.swift:13-20; scripts/lib/life/* | minimums, ranks, commute |
| ~/.openclaw/workspace/SCHEDULING.md | read | orion-remote:633; SchedulingMemory.swift:4-12 | pushed into prompts |
| var/brain/ | git mirror (manual) | orion-note header | vault mirror |
| orion/memory.py ORION.md vault | write/read | orion/memory.py:10-43 | dead Python path |

### Tool calls (tools exposed to a model, or CLIs a model invokes)
| Tool / CLI | Defined at (path:line) | Who calls it | Args | Side effects / gate |
|---|---|---|---|---|
| orion_task_run, orion_tool_propose, orion_tool_list, orion_tool_run, orion_task_status, orion_permission_status, orion_permission_change | plugin/orion-control/src/index.ts:1111,1229,1290,1319,1348,1359,1436; manifest openclaw.plugin.json:259 | Claude and local worker | TaskGraph steps | typed actions, ledger, approval gate |
| orion-brain | scripts/orion-brain | Claude/worker via exec | search/read/context/learn/recent/canvas-courses/canvas-refresh | learn writes brain; canvas-refresh --apply writes course notes |
| orion-recall | scripts/orion-recall | Claude via exec | "<query>" [--all] | read only |
| orion-remember | scripts/orion-remember | Claude via exec | [--user] "<text>" | appends daily note or USER.md |
| orion-note | scripts/orion-note | Claude via exec | list/show/write --claim --epistemic … | writes vault concept notes |
| orion-skill | scripts/orion-skill | Claude via exec | list/show/write/disable | writes workspace skills (.bak) |
| orion-help / orion-selfdoc | scripts/orion-help; scripts/orion-selfdoc | Claude / deploy | `<tool>` | prints usage; regenerates TOOLS.md |
| orion-agenda, orion-reschedule, orion-tasks, orion-checkin, orion-phone-time, orion-session, orion-lights, orion-wake, orion-log, orion-show, orion-reach, orion-now, orion-connect | referenced in AGENTS.md, job-instructions.ts | Claude/worker | see AGENTS.md | change calendar/phone/etc. (other chapters) |
| orion-agenda-change | AGENTS.md:107-109 (instructed) vs skills/calendar | not allowlisted (0 hits in exec-approvals.json) | task-add | cannot run via exec |
| tool_search, web_search, web_fetch, browser | OpenClaw | Claude (not ollama) | | web tools denied for ollama |
| Front-desk tool names (weather, lights, alarm, wake, session, phone_time, agenda, tasks, reschedule, show, app_open, browser, media, log_intake, supplements, brain, repair_note) | front-desk-prompt.ts:6 | front desk 4B (selects only) | per prompt | executed by worker/code |

### Config flags & env vars
| Name | Where read (path:line) | Default | Effect |
|---|---|---|---|
| agents.defaults.workspace | ~/.openclaw/openclaw.json | — | `~/.openclaw/workspace` is the live prompt dir |
| agents.defaults.bootstrapMaxChars / bootstrapTotalMaxChars | OpenClaw dist embedded-agent-helpers-*.js:63-64 | 20000 / 60000 | per-file cap (not overridden) |
| agents.defaults.contextInjection | openclaw.json | continuation-skip | may skip bootstrap on continuation |
| agents.defaults.thinkingDefault | openclaw.json | off | default thinking |
| agents.defaults.model.primary / fallbacks | openclaw.json | haiku-4-5 / qwen3.5:9b, llama3.2:3b | model choice |
| agents.defaults.models.*.params.cacheRetention | openclaw.json | long | 1-hour prompt cache |
| agents.defaults.memorySearch.* | openclaw.json | enabled, ollama nomic-embed-text, extraPaths vault, sources memory+sessions | memory index |
| agents.defaults.contextPruning.* | openclaw.json | cache-ttl 1h … | trims old tool output |
| skills.limits.maxSkillsPromptChars | openclaw.json | 7000 | skills index cap |
| tools.profile / alsoAllow / exec.* / byProvider.ollama.deny | openclaw.json | coding … | tool surface |
| session.reset.idleMinutes | openclaw.json | 45 | session idle reset |
| plugins.entries.orion-control.config.localRouting (+Trace, ScheduleToCloud, TestingUntil) | openclaw.plugin.json:114-135; index.ts:1673 | off (manifest) / on (live) | local routing |
| enableEpisodicCapture, episodicMemoryPath | openclaw.plugin.json:135; index.ts:1687 | off / on (live) | episodic journal |
| accountHealth, accountFailFast | index.ts:1662-1670 | on / off | account alerts |
| ORION_BRAIN_MODEL, ORION_BRAIN_THINKING, ORION_ESCALATION_MODEL | scripts/orion-remote:700,810 | — / policy / anthropic/claude-sonnet-5 | per-run overrides; "off" disables retry model |
| ORION_WORKSPACE, ORION_BRAIN_VAULT | scripts/orion_v2_workspace_sync.sh; orion-brain-manual:23-24; orion-brain-seed | ~/.openclaw/workspace; ~/Documents/orionBrain | paths |
| ORION_SANDBOX_CALENDAR | scripts/lib/eval/sandbox-bridge.mjs | — | eval calendar |
| ORION_TTS_* | openclaw.json talk/messages.tts | — | TTS |
| basic-memory config (default_project orion, semantic_search_enabled) | ~/.basic-memory/config.json | — | brain index |

### Glossary terms
| Term | Meaning |
|---|---|
| OpenClaw | third-party agent runtime/gateway ORION runs on |
| Gateway | long-lived local OpenClaw process (port 18789, loopback) |
| Workspace | `~/.openclaw/workspace/`, the live prompt/memory directory |
| Bootstrap file | workspace file OpenClaw injects into the system prompt |
| Policy digest | OpenClaw's fragment summary of the cut middle of AGENTS.md |
| Cache boundary | marker splitting stable cached prompt prefix from dynamic tail |
| continuation-skip | skip re-injecting bootstrap files on safe continuation turns |
| Skill | folder with SKILL.md; description always in prompt, body read on demand |
| Prompt diet | 2026-10-07 trim of always-on files (`f17471c`), reverted 10-08 (`0691dc4`) |
| Look it up | 2026-10-12 pattern: manual in the brain, small core prompt |
| Front desk | 4B local router choosing answer/tool/escalate/ask/ignore |
| Worker | qwen3.5:9b local model doing the job with frozen instructions |
| Honesty block | shared prompt text mapping tool outputs to what may be claimed |
| Transport | orion-remote / Mac app wrapper adding context to Nick's message |
| Channel brief | CHANNEL_BRIEF facts block prepended by orion-remote |
| Live facts | phoneContext block read fresh for each phone message |
| Truth check | orion-remote one-time re-ask when reply claims done with 0 tools |
| Episodic capture | zero-model regex journal of Nick's durable statements |
| Brain / vault | Obsidian vault ~/Documents/orionBrain, indexed by Basic Memory |
| Basic Memory | local Markdown knowledge-graph tool (observations + relations) |
| Epistemic stamp | provenance line in a note body (user-stated/observed/inference/source-derived) |
| Manual notes | brain notes generated from workspace sections |
| Active memory | OpenClaw plugin running a memory sub-agent before replies (unverified here) |
| Standing rule | statement like "always/going forward" saved by transport before the model runs |
| Thinking policy | regex rule choosing `--thinking low` vs `off` |
| Personality / mode | defined-but-unwired tone/mode profiles |
