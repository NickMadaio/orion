# Fragment: history-a (commits 1abb90b → 16ba5e9, 2026-07-28 → 2026-08-31)

Companion to `docs/learn/02a_history_jul28_aug31.md`. This scope is history, so most citations are historical, written `hash:path:line`. Paths moved later: `planning/` became `docs/planning/`, and `openclaw-plugins/` + `openclaw-workspace/` became `plugin/`. No secret values appear here; keys are named by env var or Keychain item only.

### API calls
| Service | Endpoint / method | Called from (path:line) | Auth (by name only) | Purpose |
|---|---|---|---|---|
| Ollama (local) | POST `http://127.0.0.1:11434/api/chat` | `a4a4809:orion/provider.py:10-17` | none | Python-era local model (gpt-oss:20b) |
| Anthropic | POST `https://api.anthropic.com/v1/messages` | `a4a4809:orion/cloud.py:118` | `ANTHROPIC_API_KEY` (.env, later Keychain SecretRef) | Python-era tiered cloud escalation |
| Brave Search | GET `https://api.search.brave.com/res/v1/web/search` | `a4a4809:orion/web.py:10,86` | `BRAVE_SEARCH_API_KEY` | Python-era web search |
| OpenClaw gateway | CLI `openclaw agent --json …` (gateway on 127.0.0.1:18789) | `2f6bc6e:native/Orion/Sources/Orion/GatewayClient.swift:104-107` | gateway token (in `~/.openclaw/openclaw.json`; SecretRef from Phase 0) | Every chat/voice turn from the app |
| ElevenLabs | POST `/v1/text-to-speech/{voice}/stream` | `93e9a42:scripts/orion_tts_daemon.py:1112` | `ELEVENLABS_API_KEY` | Cloud TTS |
| ElevenLabs | POST `/v1/text-to-speech/{voice}?output_format=pcm_24000` (2-char probe) | `93e9a42:scripts/orion-keys:71` | `ELEVENLABS_API_KEY` | Key check on the real endpoint (`95a9cac`) |
| Deepgram | WSS `wss://api.deepgram.com/v1/listen` | `93e9a42:native/Orion/Sources/Orion/DeepgramSpeech.swift:57` | `DEEPGRAM_API_KEY` | Cloud STT |
| Deepgram | GET `https://api.deepgram.com/v1/projects` | `93e9a42:scripts/orion-keys:128` | `DEEPGRAM_API_KEY` | Key check |
| Whoop | OAuth `api.prod.whoop.com/oauth/oauth2/auth` + `/token` | `93e9a42:native/Orion/Sources/Orion/Connections.swift:94-95`; refresh `93e9a42:…/WhoopClient.swift:598` | Keychain client id/secret + tokens | Wearable data; `offline` scope (`6b8cd3b`) |
| Whoop | GET `https://api.prod.whoop.com/developer/v2/…` | `93e9a42:native/Orion/Sources/Orion/WhoopClient.swift:94` | OAuth bearer | Recovery/sleep/strain |
| Plaid | POST `/link/token/create`, `/link/token/get`, `/item/public_token/exchange`, `/accounts/balance/get`, `/transactions/get`, `/item/get` on `https://{sandbox\|production}.plaid.com` | `93e9a42:native/Orion/Sources/Orion/PlaidClient.swift:75,183,257,351,444,461,508` | Keychain client_id/secret (environment-stamped) + per-Item access tokens | Bank balances/transactions |
| Google | OAuth `accounts.google.com/o/oauth2/v2/auth` (YouTube read scope) | `93e9a42:native/Orion/Sources/Orion/Connections.swift:118-120` | Keychain | Brand tab (no reader behind it, `9f64722`) |
| Instagram | OAuth `www.instagram.com/oauth/authorize`, `api.instagram.com/oauth/access_token`, long-lived exchange `graph.instagram.com/access_token` | `93e9a42:…/Connections.swift:187-188`, `93e9a42:…/OAuthFlow.swift:311` | Keychain | Replaced dead Basic Display (`865f446`) |
| TikTok | OAuth `www.tiktok.com/v2/auth/authorize/`, `open.tiktokapis.com/v2/oauth/token/` | `93e9a42:…/Connections.swift:159-160` | Keychain (`client_key`) | Brand tab |
| Ollama (local) | POST `http://127.0.0.1:11434/api/generate` | `93e9a42:native/Orion/Sources/Orion/LocalModel.swift:80` | none | Brief/health narratives, bypassing the agent (`4c3bee9`) |
| Apple EventKit / Contacts / chat.db | framework calls; SQLite read-only of `~/Library/Messages/chat.db` | `a79bb89`, `4fb9ba1`, `5444062` (`MessagesReader.swift`, `ContactsClient.swift`) | TCC: Reminders, Calendars, Contacts, Full Disk Access | Tasks, calendar, contacts, messages |
| Sparkle appcast | GET placeholder `raw.githubusercontent.com/ORION_OWNER/ORION_REPO/main/appcast.xml` (404s in range) | `93e9a42:native/Orion/Sources/Orion/UpdateController.swift:48` | EdDSA public key in Info.plist (`SUPublicEDKey`); private key in Nick's login Keychain | Auto-update |

### System prompts / instruction text sent to models
| Name | Source (path:line) | Sent to (model/route) | When | Summary |
|---|---|---|---|---|
| LOCAL_CAPABILITY_SUMMARY | `1abb90b:orion/permissions.py:4-8` | gpt-oss:20b via Python runtime | every Python-era turn | Exact-target file actions OK; ask before delete/overwrite/system/external |
| Workspace AGENTS.md / TOOLS.md / SOUL.md / SELF.md / USER.md / MEMORY.md / PLAYBOOK.md | live `~/.openclaw/workspace/`; committed `93e9a42:openclaw-workspace/*` | OpenClaw agent (Haiku primary) | injected every session | Runtime persona and rules; tool_search→describe→call (`c17689d`); "pick a sensible name" (`7f281f1`); wiring is never an answer (audit 08-09); truncated at 20k chars until 08-14 |
| CATALOG_SUMMARY tool description | `588f6a1:openclaw-plugins/orion-control/src/index.ts` (~350) | OpenClaw agent | tool registration | Generated from ACTION_CATALOG so it cannot drift |
| Morning brief prompt | `93e9a42:native/Orion/Sources/Orion/MorningBrief.swift:126-141` | Ollama gpt-oss:20b direct | first session of a logical day | 2–3 sentences; never invent numbers; "not connected" ≠ "nothing scheduled" |
| Health takeaways prompt | `93e9a42:native/Orion/Sources/Orion/HealthSummary.swift:105-122` | Ollama gpt-oss:20b direct | per day+phase, keyed by facts | 3–4 "LABEL — sentence" lines; no new numbers |
| Focus exit judgement | `native/Orion/Sources/SessionDomain/ExitPolicy.swift:75-100` (policy around the model) | local model (Ollama) | exit request during Firm session | Model judges the reason; a deterministic hatch opens after 3 unreachable tries in 5 min |

### Memory reads/writes (anything that persists knowledge about Nick or the conversation)
| Store (path or system) | Op (read/write) | Code (path:line) | What |
|---|---|---|---|
| `data/orion.db` (SQLite) | r/w | `1abb90b:orion/store.py` | Python-era conversations, tasks, memories (history never read back, per audit) |
| `~/.openclaw/agents/<agent>/sessions/<id>.jsonl` | read (tail) | `plugin/orion-control/src/transcript.ts:21-30,88-115` | Host-written user turns used as trust provenance |
| Session transcripts (archive) | write (move) | `scripts/orion-reset-session` (`ef324db`) | Archive a poisoned session |
| `~/.openclaw/workspace/memory/YYYY-MM-DD.md` | write | `scripts/orion-daily` (`154c3fb`, fixed `71d4581`); `scripts/orion-remember` (audit 08-09, `d9cf665`); `src/episodic.ts` (`93e9a42`) | Daily summary, explicit facts, automatic episodic capture |
| `~/.openclaw/workspace/USER.md` | write | `scripts/orion-remember --user` | Durable facts about Nick |
| OpenClaw memory index (local Ollama embeddings) + `~/Documents/orionBrain` | read | `scripts/orion-recall` (`d9cf665`); config `memorySearch.extraPaths` (live) | Semantic recall; Brain vault indexed 08-12 |
| `~/.openclaw/orion-controlled/health-log.json` | r/w (locked) | `native/Orion/Sources/Orion/HealthLog.swift`; `plugin/orion-control/src/health.ts`; lock `native/Orion/Sources/SessionService/FileLock.swift:39-49` | Supplements, workouts, water |
| `focus-state.json` / `focus-history.jsonl` | r/w (single writer) | `93e9a42:native/Orion/Sources/SessionService/SessionStore.swift:38-44`, `SessionHistory.swift:38` | Focus sessions; history append-only, never pruned |
| Task ledger JSONL + gz archive | append | `openclaw-plugins/orion-control/src/ledger.ts` (`807ee86`) | Every gated action and its outcome |
| `forge-ledger.jsonl` | append | `scripts/orion-forge` (`5f190a5`, `86908db`) | Every self-modification attempt |
| `workshop.json` | r/w | `openclaw-plugins/orion-control/src/workshop.ts` (`f09edfd`) | Proposed/approved composed tools + hashes |
| `orion-created-events.json` | r/w | `04676fd:native/Orion/Sources/Orion/AppleCalendarSync.swift` | Events Orion created |
| UserDefaults narratives | r/w | `NarrativeWriter.swift` (`5380480`, pruning `cefd605`) | Cached generated briefs/summaries |
| Apple Reminders list "Orion" | r/w (read all lists from `81cd050`) | `native/Orion/Sources/Orion/AppleRemindersSync.swift` (`a79bb89`) | Nick's tasks |
| Keychain items (connectors) | r/w | `4fb9ba1:native/Orion/Sources/Orion/Connections.swift` | OAuth/Plaid credentials and tokens |

### Tool calls (tools exposed to a model, or CLIs a model invokes)
| Tool / CLI | Defined at (path:line) | Who calls it | Args | Side effects / gate |
|---|---|---|---|---|
| `orion_task_run` | `93e9a42:openclaw-plugins/orion-control/src/index.ts:731` | OpenClaw agent | TaskGraph `{steps:[{action,arguments}]}` | Validate → tier/profile → execute → verify → ledger |
| `orion_task_status`, `orion_permission_status`, `orion_permission_change` | same file :964, :975, :1010 | agent | task id / profile | Read status; profile change audited |
| `orion_tool_propose` / `_list` / `_run` | same file :847, :908, :937 | agent | recipe of catalog actions | Runs only if approved hash matches (`f09edfd`) |
| Catalog tiers: browser_control, media_control, home_read, file_mutate | `0e5ef84:…/src/catalog.ts` | via orion_task_run | per action | file_mutate shipped off; delete → `~/.Trash` |
| `voice_tuning_read/set` (self_tuning) | `399c036:…/src/catalog.ts` | agent | closed key list | `enableSelfTuningActions`, read-back verified |
| `supplement_take/add/status`, `workout_log/status` (health_tracking) | `93e9a42:…/src/catalog.ts:2177,2228` | agent | names, sets | Locked write to health-log.json |
| `self_modify`, source list/read | `93e9a42:…/src/catalog.ts:1286`; `7ce12ff` | agent | path, find, replace | `scripts/orion-forge` path/build/launch gates; `enableSelfModificationActions` + profile |
| OpenClaw `exec` / `group:fs` | OpenClaw built-in | agent | shell argv | Denied `c17689d`; reopened with exec allowlist per `docs/GAME_PLAN.md`; `ask: off` from 08-09 (live config) |
| `orion-remember`, `-recall`, `-agenda`, `-authority`, `-focus`, `-mission`, `-notify`, `-standing`, `-learn`, `-remote`, `-trace`, `-bench` | `scripts/` (`d9cf665`) | agent via exec allowlist | fixed argv | Narrow, allowlisted |
| `orion-calendar`, `orion-messages`, `orion-gmail-search/latest`, `orion-messages-send`, `orion-repair`, `orion-cron-deliver` | `scripts/` (audit 08-09; `81cd050`; `93e9a42`) | agent | fixed argv | Gmail forced read-only; send gated by approval |
| `orion-session` | `scripts/orion-session` (`77f8484`) | Nick / agent | start/status/pause/resume/finish/release | Client of the app's socket only (`93e9a42:…/SessionIPC.swift:474-495`) |
| `orion-forge` | `scripts/orion-forge:11-23` | self_modify executor | apply/edit/revert/status | git commit per change |
| `orion-tools review` | `scripts/orion-tools` (`f09edfd`) | Nick | — | Approves composed tools by hash |
| `OrionMacBridge delete_calendar_event` | `native/OrionMacBridge/Sources/OrionMacBridge/main.swift` (`fd343df`) | wrappers | identifier | Identifier-only delete |

### Config flags & env vars
| Name | Where read (path:line) | Default | Effect |
|---|---|---|---|
| `enableFileMutateActions` | `93e9a42:openclaw-plugins/orion-control/src/index.ts:211` | false | move/rename/delete-to-Trash tier |
| `enableHealthTrackingActions` | same :229 | false | health_tracking tier |
| `enableSelfTuningActions` | same :258 | false | voice tuning tier |
| `enableSelfModificationActions` | same :264, :402 | false | self_modification tier (also needs profile) |
| `enableSelfPluginActions` | same :270 | false (ON live from 08-13) | plugin self-edit |
| `enableV2SystemStatusAdapter` | same :331 | false | v2 contract observer on system_status |
| `plugins.entries.orion-control.hooks.allowConversationAccess` | live openclaw.json (`93e9a42:HANDOFF.md`) | — | Enables episodic capture hook |
| Permission profile (`approved_root_edit` → `consequential_local` → `external_connected`) | `src/permissions.ts`; live config | approved_root_edit | Which tiers may run |
| `exec-approvals.json` `security/ask/askFallback` | live `~/.openclaw` | allowlist / on-miss → off / deny | Shell gating |
| `tools.deny` | live openclaw.json | `group:fs, group:runtime` (07-30) → empty (08-04) | Built-in tool groups |
| `ELEVENLABS_API_KEY`, `DEEPGRAM_API_KEY` | `93e9a42:native/Orion/Sources/Orion/VoiceProviders.swift:101-102`; `93e9a42:scripts/orion_tts_daemon.py:247` | — | Cloud voice keys |
| `ORION_TTS_SPEED`, `ORION_ELEVEN_VOICE_ID`, `ORION_ELEVEN_MODEL`, `ORION_ELEVEN_BASE_URL` | `93e9a42:scripts/orion_tts_daemon.py:205,229,231,234` | 1.0 / a stock voice id / `eleven_flash_v2_5` / api.elevenlabs.io | TTS tuning (read from .env since `b0b21be`) |
| `ANTHROPIC_API_KEY`, `BRAVE_SEARCH_API_KEY` | `a4a4809:orion/cloud.py`, `a4a4809:orion/web.py:82` | — | Python-era cloud |
| `ORION_FOCUS_STATE`, `ORION_FOCUS_HISTORY`, `ORION_SESSION_SOCKET` | `93e9a42:native/Orion/Sources/SessionService/SessionStore.swift:44`, `SessionHistory.swift:38`, `SessionIPC.swift:196` | app defaults | Redirect session files for tests |
| `ORION_VERSION`, `ORION_BUILD_NUMBER`, `ORION_BUNDLE_OUT` | `native/Orion/make_app_bundle.sh:69` | VERSION file / `git rev-list --count HEAD` | Bundle versioning |
| `--allow-adhoc` | `native/Orion/make_app_bundle.sh:10,15` | off | Only route to an unsigned build |
| `DEVELOPER_DIR` | `native/Orion/Tests/run-domain-test.sh` (`8baac06`) | — | XCTest from Xcode, not CommandLineTools |
| `OrionWakeWordEnabled` (UserDefaults) | `93e9a42:native/Orion/Sources/Orion/SummonSettings.swift:95` | — | Wake word; auto-disable bug 08-12 |
| `orion.update.feedURL` (UserDefaults) | `93e9a42:native/Orion/Sources/Orion/UpdateController.swift:49` | placeholder feed | Sparkle feed override |

### Glossary terms
| Term | Meaning |
|---|---|
| OpenClaw | Open-source local-first agent runtime adopted 2026-07-28 as ORION's brain; runs a loopback gateway with agents, skills and plugins |
| Gateway | OpenClaw's background service (`ai.openclaw.gateway`, 127.0.0.1:18789) |
| orion-control | ORION's TypeScript OpenClaw plugin: action catalog, validator, executors, verifier, ledger |
| TaskGraph | The structured list of catalog actions the model submits to `orion_task_run` |
| Capability tier / permission profile | Tier = switchable group of actions; profile = named level deciding which tiers may run |
| "The gate" | The plugin's validate → profile → execute → verify → ledger path |
| Provenance / taint | Where text came from; host-written user turns are trusted, tool results and files are untrusted |
| TCC | macOS privacy-permission database (mic, Accessibility, Calendars…) |
| cdhash / ad-hoc signing | Content hash identifying an unsigned-identity build; changes each build, so TCC resets |
| Designated requirement | Bundle id + certificate rule TCC keys on for a properly signed app |
| Hardened runtime / entitlements | Signing mode that denies device access unless the binary carries entitlement claims |
| Sparkle / appcast / EdDSA | macOS auto-updater, its release feed, and its update-signature scheme |
| LaunchAgent / launchd | macOS per-user services and their manager |
| MLX | Apple's on-device ML framework (local TTS) |
| Plaid Item / Hosted Link | One bank login (own access token) / Plaid-hosted linking page |
| OrionDay | A "day" that starts at wake time (later of Whoop wake and 4 am) |
| Gate (focus build) | Numbered step 0–10 of the 2026-08-11 focus-session plan |
| Phase (v2) | One of 85 numbered steps of the ORION v2 manifest (0–84); the program's vocabulary |
| Phase gate | Record in `PHASE_GATES.json` of whether a phase's exit requirements passed |
| orion-forge | Script letting Orion edit his own Swift with path/build/launch gates |
| Workshop | Composed tools = approved recipes over catalog actions, bound to a hash |
| SecretRef | OpenClaw reference to a secret held in the Keychain instead of plaintext config |
| Codex | OpenAI's coding agent, which built v2 Phase 0/1 in its own lane |

### Decisions & reversals
| Date | Decision | Why | Reversed/changed later? (hash) |
|---|---|---|---|
| 07-28 | Local-first: gpt-oss:20b default, cloud supplemental (`1abb90b`) | Cost, privacy | Yes — audit called it "backwards"; Haiku primary with local fallback by 07-30 (`a4a4809`, `807ee86`) |
| 07-28 | Keep building Orion, don't adopt OpenClaw (ADOPT_VS_BUILD) | 470 security advisories | Yes, same day — adopt OpenClaw (`a4a4809` OPENCLAW_MIGRATION_PLAN) |
| 07-28 | Python runtime is the product | Original build | Yes — "not the implementation path" (memory dated 07-28, committed `93e9a42`); Phase 1 keeps Python as reference only (`93e9a42`); 09-01 correction `250c0ed` |
| 07-29 | Gemma 4 31B as executive model (archived plan) | Local-first | Not adopted; Haiku primary (`807ee86`) (inferred) |
| 07-30 | Native SwiftUI app replaces WKWebView companion and browser UI | Real TCC ownership, native feel | Lasting (`2f6bc6e`) |
| 07-30 | Trust minted from host provenance, not model tags (plugin 0.7.0) | Injection hole | Kept; broke everything until transcript source added (`b95df55` → `0d3fd57`) |
| 07-30 | User's words must name every path segment (0.8.0) | Authorization | Loosened to scope (`7f281f1`); whole wording check deleted for data taint (`399c036`) |
| 07-30 | Deny `group:runtime` + `group:fs` | Gate bypass with empty ledger | Reopened with exec allowlist (`ea2fffe` GAME_PLAN, live config); in practice wrappers (`d9cf665`) |
| 07-30 | Voice daemon under launchd | Survive terminal close | Reversed in 9 min — Desktop TCC (`dff87ea` → `1d82682`) |
| 07-30 | Setup auto-creates self-signed cert | Stable identity | Stopped after 7 untrusted certs (`f8ac320` → `f018255`) |
| 07-30 | Hardened runtime on | Signing hygiene | Kept; required entitlements (`c2c4347`, `a79bb89`, `5444062`, `d623dab`) |
| 07-30 | Deepgram as default ear | Quality | Switched to Apple on-device meanwhile (`a187595`) |
| 07-30 | Chunk all TTS engines | Fast first audio | Streaming engines exempt (`b0b21be`) |
| 07-30 | file_mutate ships disabled | Deletes must be deliberate | Enabled by GAME_PLAN Batch 1.0 (`ea2fffe`, live config) |
| 08-04 | Composed tools are recipes, not code | Safe live-on-approval | Extended by code self-edit (`5f190a5`) and plugin self-repair (in `93e9a42`) |
| 08-04 | "Block what cannot be undone. Log everything else." (GAME_PLAN) | Agentic ceiling | Permission half shipped, architecture half did not (CLAUDE.md) |
| 08-04 | Reject spoken password; standing grants instead | Voice ≠ authentication | Not reversed in range |
| 08-05 | Tasks live in Reminders "Orion" list only | One source of truth | Reading widened to all lists, writing stays scoped (`81cd050`) |
| 08-05 | Calendar read-only structurally | Others' commitments | Own events (`04676fd`) → any event via sheet (`f251464`) → id-only delete (`fd343df`) |
| 08-05 | Connector secrets in Keychain | Plaintext .env unsafe | Keychain ACL prompts per build found 08-18 (`93e9a42`); provider secrets to SecretRefs (`e2b5ae3`…`1169e5b`) |
| 08-06 | Plaid Sandbox by default | Production needs approval | Sandbox/Production switch (`f33aaf5`) |
| 08-06 | Transparency via SwiftUI material | Glass look | Three corrections (`91f4b89`, `88fced5`, `9f64722`) |
| 08-07 | llama3.2:3b writes narratives | Fast | Replaced by gpt-oss:20b — misread data (`5380480`) |
| 08-07 | Narratives keyed per day/phase | Fewer generations | Keyed by facts (`cefd605`) |
| 08-07 | Timeline starts at 6 am | Hide night | All 24 hours (`27b0a7e`) |
| 08-08 | Forge approval off | Nick's choice; mechanical gates | Not reversed in range; scope later widened to plugin (risk) |
| 08-08 | Audit: drop Obsidian | OpenClaw memory suffices | Reversed — Brain indexed 08-12, vault in repo (`1efd37c`) |
| 08-09 | Exec `ask: off` | on-miss hung 240 s | Kept (audit addendum, `7d0a7b8`) |
| 08-11 | Gate 1 open until Bluetooth measured | Completeness | Closed, deferred (`df20f1c` → `6487373`) |
| 08-11 | Session, Calendar, Messages as tabs | New features | Folded same day (`81cd050`) |
| 08-11 | Small break surface before full-bleed | Focus handback first | Full-bleed shipped (`d623dab`) |
| 08-11 | Heartbeat as main-run-loop Timer | Copied pattern | DispatchSourceTimer (`b4baaa0`) |
| 08-11 | One handoff, archive done docs | Single truth | Handoffs multiplied (root + v2), reconsolidated 09-07 (out of range) |
| 08-18 | Sparkle as sole dependency | Shipping friction | Feed/rollback still missing in range (`93e9a42`) |
| 08-18 | "Do not commit or push unless asked" | No remote | Reversed (`66b9e3a`); 09-30 "commit and push every finished piece" |
| 08-18 | External CI not enabled | Uploading history needs a decision | CI added later (`a17299f`, 09-30, out of range) |
| 08-18 | Phase 0 blocked, nextPhaseAllowed false | Secrets unresolved | Phases 0 and 1 closed 08-20, Phase 1 with deviation (`93e9a42`) |
| 08-19 | Strict v2 bridge throws on mismatch | Contract fidelity | Observer, never a gate (`93e9a42`) |
| 08-20 | Fold brain, privacy site, test workspace into one repo | Four stale copies | Archive later moved out of repo 09-30 (out of range) |
