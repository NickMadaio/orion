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

## 4. What was changed (this branch)

See section 5 (filled in as the work lands).

## 5. Fixes

_In progress._
