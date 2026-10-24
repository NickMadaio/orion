# 2026-10-23 voice latency: "minutes to respond vocally makes no sense"

Nick, 2026-10-23: he asked ORION something out loud "not long ago" and it "either timed out or was so slow i gave up".
Branch `feat/voice-fluid` (worktree `ORION-worktrees/voice-fluid`, from origin/main 7c8f6b1). Live state was read only.
App and Ollama logs are BST (UTC+1); the routing trace, shadow rows and session files are UTC.

## 1. What the logs say about 2026-10-23

**No voice turn reached ORION on 2026-10-23.** Every place a turn leaves a mark was checked:

| Source | Last turn activity | 10-23 |
|---|---|---|
| `~/.openclaw/logs/orion-app.log` (`[wake]`, `[press]`, `[ear]`, `[deepgram]`, `[voiceid]`, `[turn]`, `[thinking]`, `[bargein]`) | 2026-10-20 20:45 BST | nothing. Only the morning brief (`[speech] speaking 326 chars` 09:37:57) and `[reach]` bubbles |
| gateway log (`~/Library/Logs/openclaw/gateway.log`, `/tmp/openclaw/openclaw-2026-10-23.log`) | agent run `75e75a66…` ended 2026-10-22 00:17 BST (a probe) | only "update available" and "Memory index updated" |
| `agents/main/sessions/sessions.json` (max `updatedAt`) | 2026-10-21 23:17Z (`orion-probe-plugin`) | none |
| `local-routing/shadow.jsonl` / `.trace` | 2026-10-21 23:17Z | none |
| `~/.ollama/logs/server.log` | `/api/chat` at 2026-10-22 22:32-22:33 (28 s, 52 s) came from the Ollama desktop app (preceded by its `/api/me` 401 and model-recommendations calls), not the gateway | **zero `/api/chat`**; only the brief-choice `/api/generate` calls (0.4-5.3 s) |
| `orion-tts.err.log` | morning brief 09:38:01 (`first_ms=3181`) | no reply job |
| phone thread (`chats/phone-history.json`) | last message from Nick 2026-10-16 | only ORION's reminders |

What the Mac was doing (`pmset -g log`, `pmset -g`):

- On battery all day (50% at 00:54, 31% at 21:38) with **Low Power Mode on** (`powermode 1`).
- **Lid closed (clamshell sleep) from 01:30 to 16:06.** Lid open only 16:06-16:21, 16:23 (15 s), 17:15 (10 s), 17:17 (20 s), 20:33-20:35, 20:58 onward.
  Everything ORION did between those (09:37 brief, 12:13 relaunch, reminders) ran in dark wakes.
- The app exited uncleanly some time after 09:38 (no log lines at all 09:38-12:13; at 12:13 "found a route change left over from a run that did
  not exit cleanly") and relaunched at 12:13 while offline (`[plaid] The Internet connection appears to be offline`).
- 16:06-16:21 the mic monitor heard sustained sound (`[audio] level` 0.40-0.87 every minute) but **no wake was recognised and none was rejected**
  (a rejected wake logs `[voiceid] ignored a wake`). Nothing was transcribed, so nothing was sent.

So on 10-23 the experience "he timed out" can only have been one of: speaking with the lid closed (the Mac is asleep, nobody is listening),
or a wake word that never fired during 16:06-16:21. Neither produces a turn, a reply or an error: ORION was simply silent, which is
indistinguishable from "so slow I gave up". There was no gateway timeout today.

## 2. The most recent real voice turns (per-stage)

### 2026-10-20 19:45Z (20:45 BST), "I'm meal prepping. That's why. Sorry." — 18 s of silence, no timeout

| Stage | Time (UTC) | Δ | Source |
|---|---|---|---|
| wake accepted | 19:45:17 | | app `[voiceid] accepted 0.647` |
| STT, last partial | 19:45:20 | 3 s of speech | app `[deepgram] heard something` |
| STT end + endpoint + `openclaw agent` CLI spawn + gateway prep | 19:45:23.59 | **~3 s** | trace `before_model_resolve` |
| desk (4B), decision `ignore` | 19:45:27.8 | **4.2 s** | shadow `decision.ms 4233`, Ollama 4.23 s |
| flow `say` + worker (9B) | 19:45:32 | 2.5 s | Ollama |
| honesty review: 3 finalize passes, two rewrites ("claims what the tools don't show") | 19:45:38.16 | **~5 s** | 3 shadow rows, Ollama 1.4 + 1.8 + 1.6 s |
| reply reaches the app, TTS start | 19:45:38 | | app `[speech] speaking 81 chars` |
| first audio | ~19:45:38.4 | 0.2 s | TTS `first_ms=212` |

**18 s with nothing audible.** The answer itself ("I didn't actually do that — nothing was started…") is the second rewrite.

### 2026-10-20 15:15Z, "reschedule my day after my marketing class…" — 4 min 40 s

Already audited in `2026-10-20-reschedule-incident.md`: STT/chat 15:15:54 → `before_model_resolve` 15:15:59.5 (**5.5 s** CLI + gateway prep) →
desk aborted at 8 s → host session 6.6 s later → flow form call 22 s, cut by the host's 15 s hook limit → full 17.7k-token prompt →
**worker first call 3 min 1 s** → finalize 15:20:39 (turnMs 279,640). Battery, Low Power Mode. The reply was not spoken (no `[speech]` line
at 16:20:41 BST): a typed or abandoned turn. The 55 s hook budget, the 40 s honest line and the code-run replan fixed that shape.

### 2026-10-20 08:11Z (09:11 BST) — a turn that went silent

`[press]` → `[ear] Deepgram selected` → `[deepgram] socket OPEN` and then nothing: no partial, no turn, no reply, no message. One more silence.

## 3. Root causes of "slow / timed out"

1. **ORION is silent for the whole turn.** Nothing audible happens between his last word and the reply: 18 s on a two-line answer,
   minutes on a hard one. "Still working…" is visual only, and only once he looks at the panel. Every slow turn feels like a dead one.
2. **Fixed overhead before any model runs: 3-5.5 s.** Each turn spawns the `openclaw` CLI (bash shim → Node → WebSocket to the gateway).
3. **The 4B desk costs 4-8 s on battery + Low Power Mode** for a sentence it then ignores, and the honesty review can add up to three
   more passes (~5 s) on a spoken one-liner.
4. **Nothing bounded a voice turn.** The app waits up to 300 s (`RunTimeouts.agentTimeout`); the hook's honest line comes at 40 s and only
   for change requests. There was no point at which ORION said "this is taking too long, I'll text you".
5. **When the ear is not listening (lid closed, wake not recognised) nothing tells him.** Out of scope for code here; noted below.

## 4. What was built (branch `feat/voice-fluid`)

| | Change | Where | Tests |
|---|---|---|---|
| 1 | **Instant cue.** 1.2 s after his last word, if the reply is not in, a canned phrase matched to the request plays: lookup "Let me look." / "Let me check.", change "On it.", needs thought "Hmm, let me think about that.", else "Mm, one sec." Four phrasings per kind, never the same one twice running. No model call. A reply inside 1.2 s is spoken bare. Never started while the mic hears him (0.6 s quiet), dropped after 4 s. Phrases are rendered once by the TTS daemon (file mode, his reply voice) into `~/Library/Caches/Orion/voice-cues/` 8 s after launch and played from disk (a few ms); an unrendered cue is skipped, never played late. | `VoiceCue.swift` | `VoiceFluidTests` (cue timing, kind, variety, cache names) |
| 2 | **Real progress.** The plugin writes `orion-controlled/turn-progress/<session>.json`: `understanding` at `before_model_resolve`, code's reads (calendar, tomorrow, deadlines, notes, messages), each worker tool call (calendar read, to-dos, a calendar write with its target: "making the change to Gym"), `thinking` when the prompt is built, `double-checking` on a revise round, `done` at finalize/agent_end. Atomic writes, 0600, never throws. The app reads it during a voice turn: first update at 9 s, then every 13 s, at most 3, each the newest stage not yet said ("Still on it — checking your calendar."), never a repeat; with nothing new, one "Still working on it." Shown in the bubble too. Updates wait while he talks or something plays. | `turn-progress.ts`, `local-routing.ts`; `VoiceProgress.swift` | `turn-progress.test.ts` (14), `VoiceFluidTests` |
| 3 | **45 s honest handoff.** "This is taking longer than it should — I'll text you the answer when it's done." The turn is left running (as `pauseThinking` does), the app goes back to listening, and the answer, when it lands, goes to the bubble and his phone thread (`orion-reach --kind update --channel phone`), not the speakers. A failure is shown in the bubble. Voice never sits silent past ~1.2 s, and never waits aloud past 45 s. | `AppState.swift` (`handOffVoiceTurn`, `deliverHandedOff`), `VoiceProgress.swift` | `VoiceFluidTests`, `VoiceHandoffTests` |
| 4 | **Barge-in.** A cue or update playing during `.thinking` is judged like `.speaking` (route-gated, its own text is the echo reference), so ORION does not pause himself on his own "Let me look"; Nick speaking stops it (and pauses the turn as before); Escape stops it. A reply that lands while a cue plays waits for it (at most 2 s) instead of cutting it mid-word. | `AppState.swift` | — (wiring) |
| 5 | **Speed: revise rounds.** A spoken turn gets one work-check revise round (was two); after it code says the honest line itself. Saves one 9B call (~1.5-2 s on battery) on exactly the turns that were slowest to speak. | `turn-budget.ts`, `local-routing.ts` | `voice-speed-2026-10-23.test.ts` |

AppState edits are kept small (properties, closures, one call in `send`, three helpers); the logic is in `VoiceCue.swift` and `VoiceProgress.swift`.

## 5. Speed findings not changed here

- **TTS** is not the bottleneck: 363 uncached ElevenLabs jobs, first chunk p50 344 ms, p90 756 ms. The daemon already streams the first
  sentence (first chunk ≤ 90 chars) before the rest; the gateway returns the reply whole, so that is the earliest TTS can start.
  The 3.2 s first chunk on the morning briefs is the first network call after a dark wake.
- **CLI spawn (3-5.5 s per turn)** is the largest fixed cost left. Replacing `openclaw agent` with the gateway's WebSocket RPC (or a warm
  helper) would remove most of it; it is a larger change to the gateway contract and was not attempted here.
- **Desk on battery + Low Power Mode:** 4.2 s for a one-line "ignore" (8 s budget, 2.5 s while degraded). With the cue at 1.2 s this is
  no longer silent. Keeping ORION on AC, or turning Low Power Mode off while he talks to it, roughly halves every model stage.
- **The app's 300 s `agentTimeout`** still bounds the background run after a handoff; the voice no longer waits on it.
- **Lid closed / wake word not recognised** (10-23): nothing in code can hear him with the lid shut. Worth a menu-bar hint when the wake
  word has been suspended by sleep; not done.

## 6. Not done / to deploy (Nick's call)

- Nothing was built into the app bundle, installed, relaunched or deployed. The plugin `dist/` is rebuilt in the branch; installing it is
  the deploy. The first launch after install renders about 50 phrases once through the daemon (ElevenLabs characters ≈ 1.6k).
