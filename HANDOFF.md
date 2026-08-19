# HANDOFF

## 2026-08-16 token-efficiency and selective-recall pass — DONE + LIVE

- Root cause confirmed in the live app session: `orion-app-v2` had reached
  42,923 tokens and was carrying old tool results forward. It was rotated with
  the supported `sessions.reset` RPC, which archived the full transcript and
  created fresh session `c4672a63-19f3-463c-a00e-5aad48a366de` at 0 tokens.
- Live policy now uses a 45-minute real-idle reset, `continuation-skip` bootstrap
  injection, and cache-TTL context pruning. The newest three assistant turns are
  preserved; old large tool results are shortened or replaced in model context,
  while stored transcripts remain intact.
- Past user/assistant conversations are indexed with local Ollama embeddings.
  The valid index contains 271 session files / 482 session chunks plus the
  existing memory and Brain sources. Session visibility is same-agent only.
- Recall is conditional: self-contained requests do not trigger history search.
  Continuity cues or relevant uncertainty use 3–8 keywords and one best result.
  `orion-recall` searches extra local candidates, filters diagnostic/probe/smoke
  session noise unless explicitly requested, and returns one match by default.
- The normal `orion-doctor` no longer makes a paid agent turn. Use
  `orion-doctor --live-agent` only when an end-to-end cloud-model proof is
  intentionally needed. Its normal no-cloud run reported all clear.
- Routing decision: keep Haiku as the single conversational/tool orchestrator
  for now; do not add a local-model classification hop to every utterance. Local
  embeddings handle recall selection, maintained fast routes handle known tools,
  and the cloud model reasons only after relevant context/tool schemas are
  selected. This preserves the Jarvis response feel while removing repeated
  context rather than adding another latency-producing model call.
- Verification: full Python suite 218/218; focused recall regression 2/2; live
  config validation, local index build, recall proof, app/gateway/voice/signing
  doctor checks, and archive-preserving session rotation passed.
- Rollback config:
  `.builds/openclaw.json.pre-token-efficiency-20260816`. Extra transcript copy:
  `.builds/orion-app-v2-pre-token-efficiency-20260816.jsonl`.

## 2026-08-14 full diagnostic and capability pass — DONE + LIVE VERIFIED

This section supersedes older counts and loose ends below. The dirty worktree was
preserved; nothing was reset, committed, or pushed.

### Automatic episodic learning

- Added deterministic, zero-model-call capture of high-signal user preferences,
  corrections, and durable decisions. Questions and likely secrets are skipped;
  repeated facts are deduplicated.
- Enabled the conversation hook explicitly with
  `plugins.entries.orion-control.hooks.allowConversationAccess=true`.
- Live proof: a normal Orion turn wrote an `[auto]` project decision into
  `~/.openclaw/workspace/memory/2026-08-14.md` without an `orion-remember` call.
- Refreshed the memory index after adding the episode and the Brain architecture
  note. The architecture is layered: compact working context, episodic stream,
  semantic memory, procedural memory, selective retrieval, and consolidation.

### Token and loop control

- Added a runtime repeat guard: block the third identical consecutive tool call
  or fifth identical call anywhere in a turn; reset at `agent_end`.
- `orion-learn` now identifies typed-action-vs-shell routing mistakes and no
  longer suggests unsafe allowlist expansion. It found historical loops totaling
  about 2.41M tokens across five loops in three sessions.
- Compacted startup instructions and moved detail into routed Brain/playbook
  material. All 25 skills remain available.
- System prompt measured 44,672 -> about 34,635 characters (-22.5%). A comparable
  normal service turn measured 17,617 -> 12,272 (-30.3%).
- Related actions are now batched in one TaskGraph. The host accepts concise
  `{steps:[{action,arguments}]}` input, normalizes step IDs/arguments, and keeps
  the same safety gates. Fixed missing default home-root propagation and added
  default `.` paths for Desktop/Home listing.

### Capabilities and live service checks

- Live authority map: 157 cataloged entries — 99 AUTO, 14 NOTIFY, 13 APPROVAL,
  and 31 INTERNAL/OFF wrapper commands. The 31 are not 31 missing user features;
  their supported typed routes remain available. Fixed the spoken report so it
  now explains this instead of silently omitting the internal group.
- Normal-agent-route reads passed: Gmail, Calendar, Apple Reminders, Messages,
  Apple Contacts status, browser, Desktop, home folder, Orion reminders, health,
  system status, self-plugin, and self-repair.
- Apple Contacts is the contact source for texting. The new contact diagnostic
  reports only counts, not names/numbers. Message reads returned normally.
- Added typed `calendar_event_add`, approval-gated `calendar_event_remove`, and
  `apple_reminder_add`. The old agenda wrapper is read-only; mutations go through
  an argv-only, EventKit-verified wrapper.
- Gmail sending was intentionally not expanded. Real outbound Messages, Calendar
  writes/deletes, and Reminder creation were not fired during diagnostics because
  that would create/send real user data without a specific request. Their typed
  routes and gates are covered by tests.

### Data safety, native app, and scheduler

- Health schema is now v3 and forward-safe: unknown fields survive, corrupt/future
  files are refused, and Swift/Node writers lock correctly. Race proof: unlocked
  lost 1245/5516 updates; locked lost 0/2004, refused 0/0.
- Manifest/runtime config parity is exact at 43 keys. Native Capabilities covers
  all 24 live boolean switches.
- Installed Orion.app rebuilt, signed by `Orion Local Signing`, and passed strict
  deep signature verification. Doctor confirms gateway, live agent turn, warm
  voice service, cloud TTS, Deepgram STT, app bundle, and running process.
- Exactly three OpenClaw jobs remain: focus guard, standing orders, daily memory.
  All are enabled and last status is OK. The duplicate LaunchAgent was retired to
  a recoverable backup and setup will not recreate it.

### Verification

- Orion Control plugin: 134/134 tests.
- Native session/domain suite: 287/287 tests.
- Capability harness: 24/24; watchdog: 15/15; layout/focus UI/MacBridge/health
  race checks passed; script syntax checks passed.
- Installed plugin dist matches the tested repo dist; manifest matches; plugin
  doctor reports no issues; episodic capture and strict inline exec parsing are
  live-enabled.

### Remaining explicit decisions / limitations

- Deep security audit is 1 critical / 3 warnings / 2 info. The static critical is
  the scanner seeing Node `child_process` in `executors.js`; source review confirms
  fixed Orion wrappers are launched with argv and no `shell:` option. Keep reviewing
  any future executor additions, but do not remove the controlled-wrapper system.
- `gateway.trustedProxies` is empty because the gateway is loopback-only; keep it
  that way unless a reverse proxy is deliberately added.
- The deep CLI probe token lacks `operator.read`; normal live turns and the regular
  gateway read probe work. Do not widen that token silently.
- Haiku remains the primary model, so the audit warns about model tier. Choosing a
  stronger model is a real cost/quality/security decision, not an automatic fix.
- ChatGPT-Pro-like work mode is the product target: broad tools, planning, learning,
  repair, and capability building. Consequential effects still require notification
  or approval; raw unrestricted shell is not the definition of capability.

## Agent status — decoder/truncation/gmail/workshop

Session of 2026-08-14 (overnight). Gateway pid 79818 healthy, `plugins inspect
orion-control` → `Status: loaded`, Orion answering turns, Orion.app + TTS +
voice-id daemons all up. Plugin suite **126/126 green** (95 pre-existing,
unchanged; 31 added). Nothing left half-applied. No git commit or push.

### FIX 1 — message bodies decoding to `NSObject` — **DONE + VERIFIED**

Evidence: `messages_recent` on the real chat.db now returns twelve of twelve
real sentences, zero `NSObject` — e.g. `23:04 Dad: Want any more salad before I
toss it?`, cross-checked identically via `messages_search "salad"` and
`messages_from "Dad"`.

Cause: the reader never parsed the format — it took the longest run of printable
bytes out of the blob, and a typedstream stores its class names as ASCII, so
`NSObject` (8 chars) beat `ok` (2). Reproduced exactly with fixtures generated by
Foundation's own `NSArchiver`: 9 of 16 returned a class name.

Fix: real parser at `scripts/lib/imessage-typedstream.mjs` — validates the
`04 0b streamtyped` signature, finds the `84 01 2B` token, decodes the length
(1-byte / `0x81`+int16 / `0x82`+int32 / `0x83`+int64) and reads exactly that many
bytes. A class name is now structurally impossible; unreadable blobs return
`[unreadable message body]`, attachments return `[attachment]`.

Also fixed the same class of bug on the `text` column: a photo from Dad printed
as a bare U+FFFC (`Dad: ￼`), now `[attachment]`.

### FIX 2 — AGENTS.md silently truncated — **DONE + VERIFIED**

Evidence: 24,722 → **18,961 chars** (limit 20,000). Zero
`truncating in injected context` warnings across two restarts and several live
turns. Asked Orion about Apple Reminders — a rule that lived in the *dropped
tail* — and he answered it verbatim.

Method: removed command listings that duplicate the generated `TOOLS.md`, merged
the `orion-remember` rule that was stated twice, compressed narrative, and moved
reference material to a new `workspace/PLAYBOOK.md` (mail detail,
capability-building, Discord, music/smart home, the dated gap list). A scripted
check of 102 probes covering every original rule reports
`102/102 rules still present — none lost`, including all six previously-dropped
sections and the whole `## Voice` section.

Note for whoever looks next: these warnings never reach
`~/Library/Logs/openclaw/gateway.log` because the launchd plist sends stderr to
`/dev/null`. They are in `/tmp/openclaw/openclaw-YYYY-MM-DD.log`, reachable via
`openclaw logs`.

### FIX 3 — email search flooding context — **DONE + VERIFIED**

Evidence: `orion-gmail-search "in:inbox"` went from ~15,000 chars to **1,608**;
`orion-gmail-latest` from ~2,500 to **440**. Orion still answers "who emailed me
last and what about" correctly.

Default output is sender, subject, date, snippet, thread id. Full bodies only on
`--full` or `--thread <id>`, with quoted-printable decoded, boilerplate stripped
and a 2,000-char cap. `--readonly` and `--gmail-no-send` are applied inside the
shared client so no caller can drop them. Original invocation unchanged.

New shared libs `scripts/lib/gmail-client.mjs` and `scripts/lib/gmail-format.mjs`
— the two wrappers had been carrying byte-identical duplicated plumbing, which is
how they drifted apart in the first place.

### FIX 4 — three workshop tools misconfigured — **DONE + VERIFIED**

Evidence, live through the gateway: `tool_search "orion_tool"` now returns all
three; `orion_tool_list` → `{"tools": []}`; `orion_tool_propose` →
`status: "awaiting_review", id: "clock_check-6cc5b6a951"`; `orion_tool_run` →
correctly `rejected` for an unapproved name. Zero
`must declare contracts.tools` warnings since restart.

**There were two defects, not one.** Declaring `contracts.tools` cleared the log
warning but the tools were still unreachable: `tools.alsoAllow` in
`openclaw.json` is an explicit allowlist and never named them. They have been
non-functional since they were written — `workshop.json` had never been created.
Both fixed (manifest + `openclaw config patch`, validated).

Not verified live: `orion_tool_run` *executing* an approved tool, because
approving one is Nick's decision and I would not manufacture it. That path is
covered by the existing suite ("runs an approved tool through the normal pipeline
when the tier is on"). To close it yourself: `orion-tools review`, approve, then
call `orion_tool_run`.

I proposed a throwaway `clock_check` tool to test the pipeline and **removed it
afterwards** — `workshop.json` is back to absent, so nothing spurious is sitting
in the review queue.

### The question Nick is owed

**Both earlier "empty" results were GENUINE, not decode failures.**

- `messages_search "Orion send test"` — genuine. `messages_search "Orion"`
  returns nothing at all; no message in the database has ever contained that
  word. The send test that actually happened used the text `diagnostic test`,
  which the fixed reader finds at 2026-08-13 22:34.
- `messages_from nmadaio@icloud.com` — genuine. `messages_whoami` confirms that
  is Nick's *own* handle, so the query asks for a thread with himself. It now
  returns the one 22:34 self-send. A decode bug could not have caused that empty
  regardless: `from` filters on handle in SQL, and the old decoder returned
  non-empty text (`NSObject`) for every row, so nothing was dropped at render.

The decode bug was real and severe. It was not the cause of either empty.

### Loose ends (not blocking, not started)

- `openclaw.plugin.json`'s `configSchema` has drifted well beyond `workshopPath`:
  roughly 14 keys the code accepts and Nick's config actively sets
  (`enableMessagesReadActions`, `enableSelfConfigActions`, `browserPreference`,
  `healthLogPath`, …) are undeclared. I added only `workshopPath` and left the
  rest rather than touch config validation mid-session.
- Pre-existing, harmless: Orion sometimes calls `tool_call` with a catalog
  *action* name (`messages_recent`) instead of a tool id, gets
  `Unknown tool id`, then self-corrects via `orion_task_run`. Present in the logs
  before any of this work.

### Backups

- `~/Desktop/ORION/.builds/backup-20260814-001531` — scripts, AGENTS.md, plugin src + manifest
- `~/Desktop/ORION/.builds/backup-installed-20260814-004603` — full installed extension
- `~/.openclaw/openclaw.json.pre-workshop-tools-20260814-004923`
- `~/Desktop/ORION/.builds/Orion-KNOWNGOOD.app`, `Orion-LATEST.app`, plus several `~/.openclaw/openclaw.json.pre-*`

---

# Wider session context (2026-08-12 → 08-14)

The four fixes above were the tail end. Earlier, all verified:

| Area | State |
|---|---|
| **Brain** | Was falling back to a LOCAL model on every single turn — an OpenClaw update made `plugins.allow` gate provider discovery, so Anthropic never loaded. Fixed via `doctor --fix` (`bundledDiscovery: "compat"`). Now `anthropic/claude-haiku-4-5-20251001`, ~4s. This was the cause of the original "errors and timeouts" complaint. |
| **Self-propagation** | Falsely reported disabled by drifted tier tables in `orion-selfdoc`; fixed at source. `self_tuning` + `health_tracking` were collateral, also recovered. |
| **Obsidian** | `memorySearch.extraPaths` → `~/Documents/orionBrain`, 48 files. He reaches for it unprompted. |
| **Ear / thinking stall** | Cause was a stuck `.thinking` phase + subprocess hang in `GatewayClient`, not a dead mic. Watchdog added. |
| **Keychain deadlock** | Keychain reads moved off the main thread; any rebuild used to freeze the app before it opened a window. |
| **Messages — send** | Profile raised to `external_connected` (v3, audited). Approval→re-run fixed: the compact call form had no field for the approval hash, so it was mechanically impossible, not skipped. |
| **Self-repair beyond Swift** | Deployed — config + scripts + plugin surfaces, four gates, rollback. All flags on incl. `enableSelfPluginActions`. |
| **Proactive delivery** | Cron jobs were failing `Channel is required` ~592×/day into the void. Routed via `orion-cron-deliver` → Discord with filtering/dedup/rate limits. |
| **Google auth** | Re-authed by Nick; verified working through the gateway (Gmail + Calendar). |
| **Distractions** | Now reasoned per-app, not a list, with a mechanical never-quit floor (unsaved work, Electron apps unreadable → never closed). |

## Open — needs Nick

1. **Focus shortcut** not saved under a findable name (`shortcuts list` shows "New Shortcut"). Contract: ONE shortcut, input is one line `on <mode>` / `off <mode>` lowercase. **`shortcuts run -i` takes a FILE PATH, not text.** Test: `printf 'on work' > /tmp/f.txt && shortcuts run "ORION Focus Toggle" -i /tmp/f.txt`. Custom modes: add `on <name>`/`off <name>` If-blocks + list the name in Settings ▸ Focus session.
2. **Settings capability panel has never been clicked by a human.** Flip something harmless first.
3. **`enableSelfPluginActions` is ON** — lets Orion edit the source of the plugin that defines what he may do (in-process code execution). Gated by compile + full suite + health probe + rollback. Reverse: `openclaw config set plugins.entries.orion-control.config.enableSelfPluginActions false` + restart.

## Open — engineering, highest value first

1. **He barely learns.** `orion-remember` works but fired ~once in four days; 08-12 recorded nothing despite hours of conversation. Daily files are ledger-generated (what tools ran), not episodic (what Nick said). **This is the gap between a tool and something that knows him.**
2. **Sandboxing before trusting plugin self-edit** — only structural fix is making `openclaw.json` + `permission-state.json` unwritable by the gateway uid (root-own or `chflags`). Needs sudo + a design decision.
3. **Gateway memory** 1.05 GiB vs 512 MiB threshold.
4. **Wake-word auto-disable** (`AppState.swift:336/341`) persists `OrionWakeWordEnabled = 0` on any transient mic failure, no retry. Nick turned it off manually on 08-12 so it was NOT the cause then — but the latent path is real.
5. **Music vs distraction-closer conflict** — closer quits Music while the pauser wants to resume it.

## Parked idea — twin agent

Higher-reasoning model, own persona, audits Orion objectively. Full note at
`~/.claude/projects/-Users-nickmadaio/memory/orion-twin-agent-idea.md`.
Motivation is concrete: Orion claimed a text was sent when the task sat at
`needs_approval`, and couldn't inspect his own permissions. A same-model
self-audit inherits the same blind spots. Design tension: the twin needs
authority to repair Orion, which is a second path around the trusted_user gate.
Recommendation given: **one boundary, many models behind it** — twin reads
everything, writes nothing without Nick.
