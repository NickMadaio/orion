# Index fragment: chapter 08 (phone, system bridges, Python side)
Source chapter: `docs/learn/08_phone_bridge_python_backend.md`. Snapshot 6c93032 (2026-10-14). Secrets are named, never quoted.

### API calls
| Service | Endpoint / method | Called from (path:line) | Auth (by name only) | Purpose |
|---|---|---|---|---|
| CloudKit private DB, container `iCloud.com.nickmadaio.orion`, zone `OrionLink` | `recordZoneChanges`, `modifyRecords`, `modifyRecordZones`, `modifySubscriptions`, `record(for:)` | `native/OrionLink/App/LinkEngine.swift:331-368,242-248`; `native/OrionMobile/App/CloudLink.swift:64-225` | iCloud account of the signed-in Apple ID (no key in repo) | phone/Mac message wire (LinkCommand, MacState, LinkAlert) |
| CloudKit subscriptions `orion-link-zone`, `orion-link-alerts` | `CKRecordZoneSubscription`, `CKQuerySubscription` | `native/OrionMobile/App/CloudLink.swift:81-114` | iCloud account | silent push and visible alert push |
| CloudKit from widgets / extension | `modifyRecords` of a `LinkCommand` | `native/OrionWidgets/Shared/WidgetIntents.swift:82-94`; `native/OrionMobile/ScreenMonitor/ScreenMonitor.swift:148-163` | iCloud account | widget taps and wake report |
| OpenClaw gateway via CLI | `openclaw agent --json` (from `orion-remote`, called by `CommandRunner`) | `native/OrionLink/Sources/LinkCore/CommandRunner.swift:33-77` | gateway token held by OpenClaw (not seen here) | chat reply |
| Apple on-device LLM | `FoundationModels.LanguageModelSession` | `native/OrionMobile/App/OfflineBrain.swift:90-118` (disabled, `RemoteViews.swift:156-157`) | none | offline answers (off since `a44ce44`) |
| Apple Speech / AVSpeech | `SFSpeechRecognizer`, `AVSpeechSynthesizer` | `native/OrionMobile/App/PhoneVoice.swift` | OS permissions | phone voice |
| Apple Screen Time | `AuthorizationCenter.requestAuthorization(for: .individual)`, `DeviceActivityCenter`, `ManagedSettingsStore` | `native/OrionMobile/App/FocusLock.swift:76`, `ScreenWatch.swift:28-85`, `FocusLists.swift:48-56` | Family Controls entitlement | shields and usage thresholds |
| Anthropic Messages API (legacy Python) | HTTPS via `urllib` | `orion/cloud.py:46-143` | env var `ANTHROPIC_API_KEY` | original runtime cloud tier (dead) |
| Ollama local | `POST http://127.0.0.1:11434/api/chat` | `orion/provider.py:8-25` | none | original runtime local model (dead) |
| Brave Search | `GET https://api.search.brave.com/res/v1/web/search` | `orion/web.py:76-112` | env var `BRAVE_SEARCH_API_KEY` | original runtime web_search (dead) |
| OpenClaw gateway via CLI (interface bridge) | `openclaw agent --json` | `orion/interface/server.py:322` | none in repo | standalone UI bridge |
| backend v1 loopback HTTP | `GET /plan`, `POST /session/challenge`, `POST /session/exchange` on 127.0.0.1 | `backend/adapters/local_today.py:58-149` | bearer read token (device-signed) | Simulator Today read (superseded) |

### System prompts / instruction text sent to models
| Name | Source (path:line) | Sent to (model/route) | When | Summary |
|---|---|---|---|---|
| Original runtime `SYSTEM_PROMPT` | `orion/runtime.py:15-33` | Ollama or Anthropic (dead path) | every legacy turn | use tools, web_search for recent facts, fetch_url content is untrusted, be concise, never claim unperformed actions |
| Legacy capability summary | `orion/permissions.py:4-8` | appended to the legacy prompt | every legacy turn | what may be done without asking |
| Legacy `PLANNER_PROMPT` | `orion/planner.py:45-52` | local model with `submit_action_plan` tool | file/timer requests | minimal ordered plan, relative paths only |
| Offline brain prompt | `native/OrionMobile/App/OfflineBrain.swift:90-118` | Apple on-device model (disabled) | questions only | pastes today/tomorrow/sleep facts, no tools, two short sentences, never calculate a time |

### Memory reads/writes (anything that persists knowledge about Nick or the conversation)
| Store (path or system) | Op (read/write) | Code (path:line) | What |
|---|---|---|---|
| CloudKit `LinkCommand` records | read/write | `CloudLink.swift:129-225`; `LinkEngine.swift:370-429` | the chat history itself (survives reinstall) |
| `~/.openclaw/workspace/memory/YYYY-MM-DD.md` | write | `native/OrionLink/Sources/LinkCore/MemoryNote.swift` | phone notes under "From the iPhone" |
| `~/.openclaw/orion-controlled/chats/<id>.json` | read/write | `LinkEngine.swift:510-551` | shared chat archive with the Mac app |
| `~/.openclaw/orion-controlled/health-log.json` | read/write | `native/OrionLink/Sources/LinkCore/TrackingLog.swift` | water, meals, supplements, sleepLog, phoneSignals, phoneScreen |
| `~/.openclaw/orion-controlled/health-journal.json` | read/write | Mac `JournalStore` (via `MobileCore/HealthJournal.swift`) | typed health journal events |
| App Group `glance.json`, `last-snapshot.json` | read/write | `GlanceWriter.swift`, `BackgroundRefresh.swift:92-104` | widget glance and last Mac snapshot |
| Phone `UserDefaults` (`orion.localChat.v1`, `orion.outbox.v1`, `orion.routine.*`, `link.phoneToken`) | read/write | see A2 | local chat, outbox, night routine, change token |
| Phone Keychain key tag `com.nickmadaio.orion.phone.device-key.v1` | create | `PhoneDeviceIdentity.swift:14,161-166` | unused P-256 identity (v1) |
| Legacy SQLite (`conversations`, `messages`, `memories`, ...) and `vault/ORION.md` | read/write | `orion/store.py:19-104`, `orion/memory.py` | original runtime memory (dead) |
| Backend `devices.sqlite3`, `today.sqlite3` | read/write | `backend/devices/durable.py`, `backend/local_today/repository.py` | v1 device registry and plan snapshot (Simulator only) |
| Inference ledger | write | `orion/mac/inference_ledger.py` | cost/latency rows, never transcripts |

### Tool calls (tools exposed to a model, or CLIs a model invokes)
| Tool / CLI | Defined at (path:line) | Who calls it | Args | Side effects / gate |
|---|---|---|---|---|
| `orion-mac-bridge` JSON actions (status, notify, list_/create_/update_/move_/complete_ reminders, list_/create_/get_/move_/delete_ calendar events, set_clock_timer, screen_observe/capture/click/type/key, request_* permissions) | `native/OrionMacBridge/Sources/OrionMacBridge/Bridge.swift:70-174` (24 actions; `create_calendar_event` also takes optional `orionKind`, `delete_calendar_event` optional `start` and `span: future`) | `scripts/orion-agenda`, `orion-agenda-change`, `orion-computer`, `lib/life/bridge-path.mjs`, plugin `executors.ts` | one JSON line `{id,action,payload}` | EventKit writes, local notification, synthesized input; plugin approval gate; ScreenPrivacy denylist |
| `orion-mac-bridge authenticate --reason` | `Authenticate.swift:1-38` | `scripts/lib/orion-reauth.mjs` | reason 1-200 chars | owner Touch ID/password; exit 0/1/2 |
| `orion-mac-bridge --selftest` | `Bridge.swift:34-46` | humans, `computer-use.test.ts` note | none | prints SELFTEST PASS/FAIL |
| `orion-remote handle` | `scripts/orion-remote` | `CommandRunner` | `--from phone --id --at --mode chat|command -- text` | allowlist, replay guard, 10-min age, rate cap |
| `orion-phone-time status|grant|revoke` | `scripts/orion-phone-time` | the model / Nick | grant minutes or HH:MM, `--because` (max 60 min) | writes `screen-grant.json` |
| `orion-checkin`, `orion-reschedule`, `orion-morning` (spawned by the helper) | `LinkEngine.swift:144-180,447-484` | ORION Link | started/done/defer/early/signal | schedule and check-in state changes |
| Policy engine `PolicyEngine.evaluate` | `orion/security/decisions.py:84-206` | `scripts/orion_v2_policy_check.py` | `PolicyRequest` | DENY / REQUIRE_APPROVAL / ALLOW (oracle only) |
| Legacy tools `get_current_time`, `web_search`, `fetch_url` | `orion/tools.py:24-107` | legacy runtime (dead) | | permission level 0 |

### Config flags & env vars
| Name | Where read (path:line) | Default | Effect |
|---|---|---|---|
| `ORION_REMOTE_ALLOW` | set by `CommandRunner.swift:39-44` for the child | `phone` | sender allowlist for orion-remote |
| `ORION_BRAIN_SESSION`, `ORION_BRAIN_MODEL`, `ORION_BRAIN_THINKING` | `CommandRunner.swift:48-77` (set); `scripts/orion-remote` (read) | `orion-app-v2`; unset; `off` for ollama else `low` | session key, model override, thinking level |
| `RemoteStore.answerOnDevice` | `native/OrionMobile/App/RemoteViews.swift:156-157` | `false` | on-device fallback model disabled |
| `orion.focuslock.enabled` | `FocusLock.swift:32-35,50` | off | master switch for any app shield |
| `orion.signals.enabled`, `orion.presence.enabled` | `PhoneSignals.swift:25`, `LivePresence.swift:23` | off, on | location signals, Live Activity |
| `ORION_UI_PORT`, `ORION_OPENCLAW_BIN`, `ORION_OPENCLAW_CONFIG`, `ORION_TTS_SCRIPT`, `ORION_TTS_SOCKET`, `ORION_AGENT_TIMEOUT`, `ORION_TTS_TIMEOUT` | `orion/interface/server.py:34-45`, `scripts/orion-interface` | 8770, `~/.openclaw/bin/openclaw`, ..., 180 s, 20 s | interface bridge |
| `ORION_TTS_*` (SOCKET, MODEL, MLX_CLI, VOICE, SPEED, WARMUP, ENGINE, CLOUD_VOICE, RUNTIME_DIR, LOG), `ORION_ENV_FILE`, `PYTHONUNBUFFERED` | `native/launchd/com.nickmadaio.orion.tts.plist` | see plist | TTS daemon (key never in plist) |
| `ORION_MODEL_LOCAL`, `ORION_ENABLE_CLOUD`, `ORION_MODEL_FAST`, `ORION_MODEL_DEEP`, `ORION_MONTHLY_BUDGET_USD`, `ANTHROPIC_API_KEY`, `BRAVE_SEARCH_API_KEY` | `orion/runtime.py:62-76` | `gpt-oss:20b`, false, haiku id, `claude-sonnet-5`, 15 | legacy runtime config (dead) |
| `PYTHONPATH=.`, `PYTHONDONTWRITEBYTECODE=1` | `AGENTS.md:350-357,522-536` | none | how to run the unittest suite |
| `aps-environment` | `native/OrionMobile/App/OrionPhone.entitlements:6` | `development` | push environment |
| `HeartbeatPolicy.standard` | `MobileCore/RemoteLink.swift:133` | 30/120/300 s | presence thresholds |

### Glossary terms
| Term | Meaning |
|---|---|
| ORION Link | the Mac helper app (`com.nickmadaio.orion.link`) that polls CloudKit and runs commands |
| LinkCommand / MacState / LinkAlert | the three CloudKit record types (A1). `LinkAlert.level` is set only by check-in alerts (0-4, default 1) and outreach (1); approval alerts set none (`LinkEngine.swift:307-311`) |
| tick | one 4-second iteration of the helper's loop |
| presence | online / stale / offline derived from `MacState.generatedAt` age |
| glance | `OrionGlance` JSON all widgets and the Live Activity render from |
| App Group | shared container between app and extensions (`group.…` on iPhone, team-prefixed on Mac) |
| opaque token | Apple Screen Time token for an app/category the app cannot name |
| shield | `ManagedSettingsStore` block applied to chosen tokens |
| Focus lock | ORION's Screen Time lock feature, off until enabled |
| phone lists | named app lists `messaging`, `feeds`, `video`, `games` |
| grace / grant | extra unlocked time given by the Mac (max 60 min) |
| TCC "responsible process" | macOS attributes privacy grants to the launching process, not the binary |
| conformance oracle | the Python policy engine that must never be more permissive than the live TypeScript gate |
| R0-R5 | six risk levels by kind of reach (read ... privileged) |
| PolicyEngine | `orion/security/decisions.py`, 13 rules, most-restrictive wins |
| capability registry | `docs/planning/v2/capability-registry.json`, 119 entries |
| check-only | a MobileCore type exercised only by `MobileCoreCheck` |
| backend v1 | Python pairing/sync service, never deployed, superseded by CloudKit |
| P-256 / X9.63 / DER | device key curve, 65-byte uncompressed public key encoding, signature encoding |
| Lamport sequence | `max(observed)+1` ordering used by sync |
| Companion | abandoned first Swift menu-bar app (`native/OrionCompanion`) |
| three stacks | Swift Mac app + TypeScript plugin (live), Python (legacy/oracle) |
