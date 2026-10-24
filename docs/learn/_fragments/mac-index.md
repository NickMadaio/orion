# Fragment: Mac app (Swift) index. Source chapter: docs/learn/07_mac_app_swift.md. Snapshot 6c93032. Paths under native/Orion/.

### API calls
| Service | Endpoint / method | Called from (path:line) | Auth (by name only) | Purpose |
|---|---|---|---|---|
| OpenClaw gateway (loopback) | GET http://127.0.0.1:<port>/healthz, /readyz | Sources/Orion/GatewayHealth.swift:61-116 | none | readiness chip |
| Ollama (loopback) | POST http://127.0.0.1:11434/api/generate | Sources/Orion/LocalModel.swift:90-142 | none | local narratives, distraction review |
| Deepgram | wss://api.deepgram.com/v2/listen?model=flux-general-en&encoding=linear16&sample_rate=16000&eot_threshold=0.7&eot_timeout_ms=5000 | Sources/Orion/DeepgramSpeech.swift:224-238 | DEEPGRAM_API_KEY (env/Keychain) as Authorization Token | STT (optional) |
| Whoop API v2 | GET https://api.prod.whoop.com/developer/v2/recovery, /activity/sleep, /cycle | Sources/Orion/WhoopClient.swift:98,211-216,376 | Keychain whoop.access_token (Bearer) | recovery/sleep/strain |
| Whoop OAuth | POST https://api.prod.whoop.com/oauth/oauth2/token | WhoopClient.swift:638-690 | Keychain whoop.client_id/client_secret/refresh_token | token refresh |
| OAuth providers | authorize pages (Whoop, Google, TikTok, Instagram) and token POSTs (oauth2.googleapis.com/token, open.tiktokapis.com/v2/oauth/token/, api.instagram.com/oauth/access_token, GET graph.instagram.com/access_token) | Sources/Orion/OAuthFlow.swift:66-332; endpoints Connections.swift:94-193 | PKCE, state, Keychain client secrets | connect services |
| Plaid | POST https://<env>.plaid.com /link/token/create, /link/token/get, /item/public_token/exchange, /accounts/balance/get, /transactions/get, /item/get, /institutions/get_by_id | Sources/Orion/PlaidClient.swift:183,257,351,444,461,509,514 | Keychain plaid.client_id/client_secret in body | bank data (read-only) |
| Sparkle feed | GET feed URL (placeholder raw.githubusercontent.com/ORION_OWNER/ORION_REPO/main/appcast.xml; override UserDefaults orion.update.feedURL) | Sources/Orion/UpdateController.swift:48,72,165 | SUPublicEDKey (Info.plist) | updates; checks disabled while placeholder |
| Unix sockets | client ~/.openclaw/orion-tts.sock, orion-voiceid.sock; server ~/.openclaw/orion-session.sock | TTSClient.swift, SpeakerVerifier.swift, SessionService/SessionIPC.swift | file mode | TTS, voice-ID, session bus |
| Loopback receiver (inbound) | 127.0.0.1:<ephemeral> for Google OAuth redirect | OAuthFlow.swift:362-539 | state | OAuth |
| Quick Open destinations | NSWorkspace.open of mail.google.com, calendar.google.com, chatgpt.com, claude.ai | QuickOpenSettings.swift:37-158 | none | launcher (not fetched by app) |
| Subprocess: openclaw | agent --session-key S --message M --json --timeout 300 [--model m] --thinking L; audit --session S --after ms --json; config set/validate | GatewayClient.swift:120-133,333; Capabilities.swift:445-480 | env GOG_KEYRING_PASSWORD (agent only) | brain, progress, settings |
| Subprocess: node scripts | orion-reach, orion-reschedule, orion-usage, orion-quick, orion-tasks, orion-watch/watches/proactive, orion-ontask-watch | AppState.swift:99,750; ModelUsageView.swift:87; Console.swift:233; LifeWatch.swift:30-47; ScheduleFocusWatcher.swift:30 | none | see chapter 5.2 |
| Subprocess: other | scripts/orion-approve, orion-project-agent, orion-projects, orion-project-queue, orion-authority; /usr/bin/security; /usr/bin/osascript; /usr/bin/shortcuts | ApprovalsOverlay.swift:88; ProjectAgentStatus.swift:404; Capabilities.swift:318; VoiceProviders.swift:188; AudioDucking.swift:166; SessionService/FocusModes.swift:217,256 | ORION_APPROVE_VIA=app | approvals, projects, keychain read, volume, Focus |

### System prompts / instruction text sent to models
| Name | Source (path:line) | Sent to (model/route) | When | Summary |
|---|---|---|---|---|
| App-context wrapper | Sources/Orion/AppState.swift:2075-2113 | openclaw agent (gateway model) | every desktop turn | session status, enforcement, allowed apps, spoken-reply instruction |
| Continuation prefix | AppState.swift:1931 | openclaw agent | after a cut-off turn | "my last message was cut off... answer the whole thing" |
| Outreach context | GatewayClient.swift:97-110 | openclaw agent | last 6h of ORION-initiated messages | "you messaged him first... may be his answer" |
| Scheduling memory | SchedulingMemory.swift:4-12 | openclaw agent | text matches scheduling keywords | up to 12,000 chars of SCHEDULING.md |
| Brief highlight | BriefNarrative.swift:16-30 | Ollama (role local, gpt-oss:20b) | brief facts change | select one id, JSON only |
| Health highlight | HealthSummary.swift:65-80 | Ollama | Health tab facts change | select one id, no prose/advice |
| Finance takeaways | FinanceSummary.swift:60-90 | Ollama | Finance tab refresh | 3-4 LABEL - sentence lines, raw dollar figures |
| Distraction review | SessionService/DistractionReview.swift:117-155 via DistractionReasoner.swift:21-45 | Ollama, temp 0.1, 2400 tokens | session start with quit-distractions on | JSON array close/keep per app |
| Project agent prompts (display only) | scripts/lib/agentic/prompts/{worker-system,reviewer-system,reviewer-repair}.md shown by ProjectAgentInstructions.swift:144-184 | local models via Node supervisor, NOT Swift | unattended runs | worker/reviewer operating instructions |

### Memory reads/writes (anything that persists knowledge about Nick or the conversation)
| Store (path or system) | Op (read/write) | Code (path:line) | What |
|---|---|---|---|
| ~/.openclaw/orion-controlled/outreach.jsonl | read | GatewayClient.swift:97-110; AppDelegate.swift:205 | ORION's own proactive messages |
| ~/.openclaw/workspace/SCHEDULING.md | read | SchedulingMemory.swift:4-12 | scheduling rules |
| ~/.openclaw/orion-controlled/life-config.json | read | SchedulingMemory.swift; TodayPlanInputs.swift:36,48 | buffer, commute, minimums |
| ~/.openclaw/orion-controlled/today-plan.json (+lock) | read/write | SessionService/TodayPlanStore.swift:64-116 | accepted plan, undo, receipts |
| .../today-plan-request.json | read/write | PhonePlanRequests.swift | phone plan requests |
| .../focus-state.json, focus-history.jsonl | read/write | SessionService stores | focus sessions |
| .../health-log.json, health-journal.json | read/write | HealthLog.swift, JournalStore.swift | health logs |
| .../chats/ (ChatStore) | read/write | AppState.swift:83-111 | native chat transcripts |
| .../sleep-actual.json | write | WhoopClient.swift exportNights | last 14 nights |
| .../finance-summary.json (0600) | write | FinanceExport.swift | balances, last 25 transactions |
| .../messages-recent.json (0600) | write | MessagesReader.swift exportIncoming | 24h incoming texts incl. handles |
| .../glance-calendar.json | write | GlanceExport.swift | calendar/todos for widgets |
| .../focus-activity.json | write | ScheduleFocusWatcher.swift | frontmost app + window title every 30s |
| .../orion-created-events.json | read/write | AppleCalendarSync.swift:141-155 | ids of events Orion created |
| .../task-progress.json | read/write | TaskPriority.swift | local task progress |
| .../reminders.json | read | ReminderService.swift | timers/alarms from plugin |
| .../lights-status.json | write | StripLight.swift | strip result |
| Apple Reminders list "Orion" / EventKit Calendar | read/write | AppleRemindersSync.swift, AppleCalendarSync.swift | tasks and events |
| macOS Keychain (service com.nickmadaio.orion.connections, accounts <connector>.<field>) | read/write | Connections.swift SecretStore | connector tokens |
| UserDefaults com.nickmadaio.orion.app | read/write | many | settings, narrative cache orion.narrative.*, quick-open items, day wake times |
| ~/.openclaw/logs/orion-app.log | append | OrionLog.swift | app log |
| ~/.openclaw/backups/orion-config/ | write | Capabilities.swift:481 | openclaw.json backups |

### Tool calls (tools exposed to a model, or CLIs a model invokes)
| Tool / CLI | Defined at (path:line) | Who calls it | Args | Side effects / gate |
|---|---|---|---|---|
| none exposed to a model from Swift | n/a | n/a | n/a | Local-model routes return JSON/text only; the agent's tools are defined in the plugin (other chapter) |
| orion-approve | scripts/orion-approve; invoked ApprovalsOverlay.swift:88 | app buttons | <id> [--chat] / deny <id> | writes the grant; only sanctioned writer |
| orion-project-agent / orion-projects / orion-project-queue | ProjectAgentStatus.swift:275-432 | Projects tab buttons | see chapter 8.4 | pause/stop/steer; launch flips unattended execution on via --enable |
| orion-reach | AppState.swift:750 | ReminderService on due | line --kind reminder --urgent --why | notifies phone or Mac |
| SessionIPC commands | SessionService/SessionIPC.swift | plugin and scripts | JSON line over unix socket | drive focus session, Messages reads |

### Config flags & env vars
| Name | Where read (path:line) | Default | Effect |
|---|---|---|---|
| ORION_VERSION, ORION_BUILD_NUMBER, ORION_BUNDLE_OUT, ORION_LINK_DERIVED | make_app_bundle.sh:22,68-69,36 | VERSION file / commit count / .build/Orion.app | version stamping, output path |
| --allow-adhoc | make_app_bundle.sh:12-18 | off | permit ad-hoc signing |
| ORION_HEALTH_LOG, ORION_HEALTH_JOURNAL | HealthLog.swift:204; JournalStore.swift:59 | ~/.openclaw/orion-controlled/... | test overrides |
| ORION_FOCUS_STATE/HISTORY, ORION_SESSION_SOCKET, ORION_QUITTABLE_APPS, ORION_FOCUS_CLIPS, ORION_CLIP_VOLUME, ORION_FOCUS_SHORTCUT | SessionService | defaults | path/test overrides |
| ORION_APPROVE_VIA | ApprovalsOverlay.swift:93 | app | tags approvals as from the app |
| GOG_KEYRING_PASSWORD | GatewayClient.swift:139 | none | passed to agent subprocess |
| DEEPGRAM_API_KEY, ELEVENLABS_API_KEY | VoiceProviders.swift:106-124 | none | voice keys |
| orion.update.feedURL | UpdateController.swift:72 | placeholder | Sparkle feed override |
| OrionPlaidEnvironment, OrionPlaidUserID | PlaidClient.swift:46-52,627 | sandbox / random UUID | Plaid env and user id |
| OrionWakeWordEnabled, OrionWakeSensitivity, OrionSummonCorner, OrionAutoDismissSeconds, OrionHologramBrightness, OrionOrbSize | SummonSettings.swift:95-188 | off, balanced, topRight, 8, 2.6, 300 | summon prefs |
| OrionSurfaceOpacity, OrionSurfaceBlur | SurfaceSettings.swift | 0.30, off | window transparency |
| OrionSTTProvider, OrionTTSProvider, OrionVoiceEndpointingMs, OrionVoiceUtteranceEndMs, OrionVoiceAppleFinalGrace, OrionSpeakingStallTimeout | VoiceProviders.swift, VoiceTuning.swift | apple, local, 900, 1800, 1.2, 12 | voice tuning |
| orion.focus.* , orion.break.* | FocusExtras.swift | all off except guided breathing | focus extras |
| orion.quickOpen.items.v1, orion.dashboard.coreStyle | QuickOpenSettings.swift; DashboardView.swift | defaults | launcher and orb style |
| -orion.initialTab <tab> (launch arg) | DashboardView.swift:23-25 | home | open a tab |
| orion.day.lastWakeAt, orion.day.lastSessionAt | OrionDay.swift | none | logical day |
| SUPublicEDKey, SUEnableAutomaticChecks, SUAutomaticallyUpdate, SUScheduledCheckInterval | Resources/Info.plist | key, true, false, 86400 | Sparkle |
| model-roles.json role local | ModelContract.swift | gpt-oss:20b fallback | local model name |
| agentic-config.json enabled | ProjectAgentInstructions.swift:97 | off | unattended project execution |

### Glossary terms
| Term | Meaning |
|---|---|
| Designated requirement | codesign identity string TCC matches on: identifier + certificate leaf hash |
| TCC | macOS privacy permission database (mic, accessibility, etc.) |
| Hardened runtime | signing option requiring entitlements for device access |
| Entitlement | signed capability grant in Orion.entitlements |
| Sparkle / appcast | update framework / its feed XML |
| EdDSA key | key pair signing update zips; public half in Info.plist |
| Orb / panel | floating hologram window (PanelController) |
| Dashboard | the 1280x820 command-center window (TextWindowController) |
| Console / Option-Tab | quick menu panel |
| Summon vs show | corner arrival vs last-dragged position |
| Phase (OrionPhase) | idle, listening, thinking, speaking, error |
| Generation counter | integer used to orphan stale async callbacks |
| Wedged turn | audit says run ended but subprocess call never returned |
| Audit poll | openclaw audit side channel feeding the progress feed |
| ThinkingPolicy | rule choosing --thinking off/low |
| LocalModel | direct Ollama HTTP client |
| Narrative selection | model returns an id of an app-written fact, never prose |
| Today plan | deterministic Swift day proposal (not calendar events) |
| Two planners | native Today plan vs agent/script planner |
| Gate 10 | focus extras: DND, music, camera, quit distractions |
| Shield / Break | full-screen guard surfaces |
| ORION Link | embedded CloudKit helper app for the phone |
| Hosted Link | Plaid's browser-based link flow |
| FDA | Full Disk Access, needed for chat.db, no API to request |
| SecretStore | Keychain wrapper, off-main loading |
| RefreshTicker | ObservableObject timer replacing timers on SwiftUI structs |
| Harness | standalone swiftc test compiled against real app sources |
