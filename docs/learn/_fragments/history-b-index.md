# history-b index — fragment for 02b_history_sep01_sep20.md

Scope: commits authored 2026-09-01..2026-09-20 (`c26272f`..`04cbc1a`, 136 commits). Paths are current (post 2026-09-15 reorg).

### API calls
| Service | Endpoint / method | Called from (path:line) | Auth (by name only) | Purpose |
|---|---|---|---|---|
| Discord Gateway | `wss://gateway.discord.gg/?v=10&encoding=json` (outbound websocket, IDENTIFY with MESSAGE_CONTENT intent) | scripts/orion-remote-bridge:55 | Discord bot token in installed `~/.openclaw/orion-remote/.env` | Inbound/outbound remote channel (`0af5235`, `0d67b37`) |
| OpenClaw gateway (CLI) | `openclaw agent --session-key … --json --message-file <path>` | scripts/orion-remote:802-811 | local gateway | Remote DM reaches the brain (`c5c5175`) |
| OpenClaw gateway (CLI) | `openclaw cron edit <id> --tz <zone>` | scripts/orion-timezone:378 | local gateway | Re-home cron jobs (`50f7110`) |
| OpenClaw gateway HTTP | `/healthz`, `/readyz` on loopback | native/Orion/Sources/Orion/GatewayHealth.swift | none | Verified readiness in Mac UI (`d0eeebb`) |
| Ollama | `POST http://127.0.0.1:11434/api/generate` | scripts/orion-code:54 | none | Offline coder (`6602853`) |
| Gmail via `gog` CLI | `gog gmail messages list "is:unread" --max 1` | scripts/orion-doctor:318-323 | `GOG_KEYRING_PASSWORD` env | Live token probe (`b5987f5`) |
| Local Today service | loopback `GET /plan`, session-exchange POSTs | backend/adapters/local_today.py; backend/local_today/session_exchange.py:55 | device-bound read token | Simulator phone reads (`964fd64`, `f830742`) |

### System prompts / instruction text sent to models
| Name | Source (path:line) | Sent to (model/route) | When | Summary |
|---|---|---|---|---|
| CHANNEL_BRIEF | scripts/orion-remote:493 | OpenClaw brain, session orion-app-v2 | Before every remote (Discord/phone) message | Channel facts; transport verbs; approval-id formats; must not contain AUTHORITY_INSTRUCTION words (`f2c1c34`, `68d1b5e`) |
| SOUL.md "Runtime truth" + Skills | plugin/workspace/SOUL.md | Orion main agent | Always loaded | Call `orion_permission_status` before answering about self (`031c46d`, `5655b0b`) |
| AGENTS.md "## Dates" rule | plugin/workspace/AGENTS.md | Orion main agent | Always loaded | Read dates from tool output, check reminders too (`e3c336f`, `5ec8125`) |
| Skills calendar / when-nick-tells-you-something / writing-your-own-skills / growing-your-brain | ~/.openclaw/workspace/skills/* (tracked under plugin/workspace/skills) | Orion main agent | On load | Written via orion-skill (`5655b0b`, `52462f4`) |
| Brief selection prompt (JSON selection) | native/Orion/Sources/Orion/NarrativeWriter.swift, BriefNarrative.swift | local model via LocalModel.swift | Daily brief / Health summary | Model selects an allowlisted fact id, never authors prose (`dfcaee2`, `becb18c`, `882681a`) |

### Memory reads/writes
| Store (path or system) | Op | Code (path:line) | What |
|---|---|---|---|
| ~/.openclaw/orion-controlled/location.json | read/write | scripts/orion-timezone; scripts/orion-standing:369 | home zone, place, expectedMove |
| ~/.openclaw/orion-controlled/location-audit.jsonl | write | scripts/orion-timezone | timezone change audit |
| ~/.openclaw/orion-controlled/projects.json | read/write | scripts/orion-project; scripts/orion-standing:442 | dated milestones |
| ~/Documents/orionBrain | write | scripts/orion-note:44 | notes with epistemic stamp |
| ~/.openclaw/workspace/skills/<name>/ | write | scripts/orion-skill:43 | Orion-authored skills (no delete) |
| Journal store under orion-controlled | read/write | native/Orion/Sources/Orion/JournalStore.swift | health journal entries |
| ~/.openclaw/orion-controlled/lock.json | write | scripts/orion-lock:65; read scripts/orion-remote:59 | LOCK ORION flag |
| ~/.openclaw/orion-controlled/selfdev-state.json | write | scripts/orion-code:507 | offline coder run state |
| Today plan snapshot | read/write | native/Orion/Sources/SessionService/TodayPlanStore.swift | revisioned accepted plan |
| backend SQLite device registry | read/write | backend/devices/durable.py:82 | phone devices and revocation |

### Tool calls
| Tool / CLI | Defined at (path:line) | Who calls it | Args | Side effects / gate |
|---|---|---|---|---|
| orion-lock | scripts/orion-lock | Nick | (none)/status/release | profile → restricted_read_only, cron off, channel stopped |
| orion-timezone | scripts/orion-timezone | Nick (withheld from Orion) | status/plan/set/expect/clear-expected | edits live cron; verifies by re-read |
| orion-remote verbs | scripts/orion-remote:195 | Discord sender | device, apps, files <root>, approve… | allowlist, lock, routing, replay, expiry, rate limit |
| orion-skill / orion-note | scripts/orion-skill, scripts/orion-note | Orion (exec allowlist) | name/claim/epistemic | bounded writes |
| orion-approve | scripts/orion-approve | Nick only | ticket id | writes human grant |
| orion-mode | scripts/orion-mode | Nick | contained/guarded/open/sovereign | strictness; floor cannot lower |
| dev operations (7) | plugin/orion-control/src/devops.ts | Orion | repo key | fixed argv, SIGKILL timeouts |
| screen_observe/capture/click/type/key | plugin/orion-control/src/catalog.ts | Orion | — | flags default off; control floored at APPROVAL |
| selfdev_queue | plugin/orion-control/src/catalog.ts | Orion | task sentence | queues orion-code work |
| file_copy | plugin/orion-control/src/file-copy-helper.py | Orion | src/dst in mutable root | no overwrite, hash verified |
| orion-code | scripts/orion-code | Nick | add/flight/loop/status | worktree commits only |
| automation propose/list/simulate/withdraw | plugin/orion-control/src/automation.ts | Orion | proposal | no install op |

### Config flags & env vars
| Name | Where read (path:line) | Default | Effect |
|---|---|---|---|
| enableStrictArguments | plugin/orion-control/src/index.ts:430,842 | off | reject undeclared args |
| enableComputerObserveActions / enableComputerControlActions | plugin/orion-control/src/index.ts:412-418 | off | computer use |
| ORION_TTS_CLOUD_VOICE | scripts/orion_tts_daemon.py:343 | false | select ElevenLabs |
| ORION_OPENCLAW_BIN | scripts/orion-timezone:76 | ~/.openclaw/bin/openclaw | test seam |
| ORION_REMOTE_ALLOW | scripts/orion-remote:192 | "local" | sender allowlist |
| NODE_TLS_REJECT_UNAUTHORIZED | scripts/orion-remote-bridge:585 | — | "0" refuses to start |
| OrionVoiceEndpointingMs | native/Orion/Sources/Orion/VoiceTuning.swift:22 | 900 | endpointing seed |
| ORION_CATALOG_DIST | scripts/orion_v2_deferred_check.py:36 | installed dist | candidate catalog for deploy |
| GOG_KEYRING_PASSWORD | scripts/orion-doctor:323 | — | gog keyring access |

### Glossary terms
| Term | Meaning |
|---|---|
| Batch A–H | Lettered re-sequencing proposed 09-01 and withdrawn same day; A = Phase 33+43, B = Phase 40 |
| Interpretation rule | Read Python-runtime requirements against the live Swift/TS stack; never reorder |
| entrySatisfied / nextPhaseAllowed | Gate booleans checked by orion_v2_phase_gate.py; `status` is unchecked |
| Deviation | Phase entered before predecessor passed, recorded with reason |
| postReviewCorrections | Appended corrections preserving original claims |
| Strictness mode | contained/guarded/open/sovereign; what an action costs, with a floor |
| Grant | Human-written file that satisfies an approval ticket |
| PlanningSignal | Derived health categories with no raw numbers |
| CivilDay / ZonedInstant | Date without instant / instant with anchoring zone |
| Astra | ChatGPT/Codex, the second assistant |
| Oblivious review | Reviewer not given implementer's narrative |
| Mutation-proven | A deliberate break makes a named test fail |

### Decisions & reversals
| Date | Decision | Why | Reversed/changed later? (hash) |
|---|---|---|---|
| 09-01 | Commit backlog as honest lumps | No history to reconstruct | No |
| 09-01 | Replace phases with batches A–H | Phase 0 inventoried a dead stack | Withdrawn same day (`53cd339`) |
| 09-01 | Keep cron on New York until landing | Wrong for 6 days otherwise | Re-homed 09-25, 17 days after landing |
| 09-01 | Don't raise camera window | Breaks tested <2% duty cycle | No |
| 09-01 | "No Keychain seam" | grep missed `enum SecretStore` | Corrected `6261878` |
| 09-01 | $99 developer program deferred to end | Nick's call | No (in range) |
| 09-02 | Drop MESSAGE_CONTENT intent | Least privilege | Reversed by Nick `0d67b37` |
| 09-02 | Remote: no fallthrough to model | Safety property | Reversed `c5c5175` (Nick) |
| 09-02 | Known verb + bad args = usage | Command channel | Reversed `80a6e46` |
| 09-02 | Rate limit 12/10min | Open channel | Raised to 40 `80a6e46` |
| 09-02 | Approval via hash | Bind to args | Human grant required `0e0036d` |
| 09-02 | Strictness ladder | Cost axis | Not wired until `f8f69d2` |
| 09-04 | Leave Phase 75 failing | Self-review of security | Closed after review `f8f69d2` |
| 09-07 | Flight model qwen3.6:27b | Wall-clock | Switched to gpt-oss:20b `0353057`; later qwen3.6:27b for agentic runtime `c9ddbec` (09-22) |
| 09-07 | Thinking off for coder | Empty responses | Turned on `6602853` |
| 09-07 | Typecheck as bar | Speed | npm test + orphan exports `3cef4f2` |
| 09-07 | One HANDOFF.md | Four stale sources | No |
| 09-07 | Organise by product route / REC gates | Phase 39 had no consumer | Back to numbered audit 09-17 |
| 09-14 | Phone pairing on Python backend | Existing contracts | Superseded by CloudKit `b59bdca` (09-30) |
| 09-15 | Repo reorganisation | Clarity | Repaired `3941e8f` |
| 09-18 | Trash recovery row reopened | Evidence was implementation only | Closed 09-26 (47) |
