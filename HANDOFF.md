# ORION — handoff

The live state of the project. Newest entry first; add yours at the top of
"Log". The previous handoff (2026-07-28 → 2026-10-12, 273 KB) and the V3
continuation notes were archived on 2026-10-14 to
`~/Desktop/ORION-archive/2026-10-14/` (still in git history).

Read with: `AGENTS.md` (working rules), `NICK-TODO.md` (things only Nick can do),
`docs/planning/v2/` (the numbered phase program and gates),
`docs/planning/v3/ORION_V3_SPEC.md` (the local-model plan) and
`docs/evals/v3/REPORT.md` (its results).

---

## Current state (2026-10-14 22:30 BST)

### How a message is answered right now

- **All of ORION runs on local models** through the OpenClaw gateway
  (v2026.7.1-2, port 18789) and the `plugin/orion-control` plugin:
  `qwen3.5:4b-q4_K_M` is the front desk (decides answer / tool / ask / ignore),
  `qwen3.5:9b` does the work. Both run in Ollama on the Mac (M5 Pro, 48 GB).
- This is `localRouting: "on"` under a **time-boxed testing window until
  2026-10-16T20:58:39Z** (`localRoutingTestingUntil` in
  `~/.openclaw/openclaw.json`). When it closes, the plugin falls back to the
  configured cloud model, which **cannot answer** (see Anthropic below), so
  ORION goes silent. Renew it (max 48 h, with Nick's OK) or pass the
  acceptance gate (`~/.openclaw/orion-controlled/local-routing/acceptance.json`:
  ≥20 real-route cases, ≥85 % pass, ≤20 s median, ≤14 days old; written by
  `scripts/eval/v3/ops/local-acceptance.mjs`).
- **Anthropic API is unusable** (credit balance too low / usage limit until
  2026-11-01). Only Nick can fix it (console.anthropic.com). The account-health
  alert tells his phone once when that happens.
- The phone never answers on-device: every message goes to the Mac
  (`RemoteViews.answerOnDevice = false`).

### The local route, in order (`plugin/orion-control/src/local-routing.ts`)

1. `before_model_resolve`: every turn goes to `ollama/qwen3.5:9b`; the 4B front
   desk decides in ~1.5 s (`front-desk.ts`, 8 s timeout).
2. `before_prompt_build`: a slim system prompt (not the 17k-token workspace).
   - "remind me / ping me / wake me…" → code extracts time + label and hands the
     9B the exact `orion_task_run` `alarm_set` call (never a to-do).
   - Schedule changes → `schedule-flow.ts`: `orion-reschedule show --json` →
     the 9B fills one form (temperature 0, block ids as enums) → code compiles
     it to exact argv (5-min buffers, invisible commutes from
     `~/.openclaw/orion-controlled/places.json`) → the scheduler runs it → a
     reply built by code. One correction round; anything else falls back.
   - Questions get the day read by code.
   - Between midnight and 05:00 "tomorrow" means today's date.
3. `before_agent_finalize`: the claims checker (`work-check.ts`) revises a reply
   that claims work no tool did, or asks instead of acting; after two tries the
   reply is replaced by an honest line. `reply_payload_sending` enforces exact
   replies.
4. Both models are kept loaded at the context they are called with (4B 16384,
   9B 32768), checked every 5 minutes (`keepWarm`).

Live 9B params (`models.providers.ollama.models[qwen3.5:9b]`):
`reasoning: false`, temperature 0.2, top_p 0.9, top_k 20, presence_penalty 0,
repeat_penalty 1.0, num_ctx 32768, keep_alive 24h, think false, num_predict
2048. Config backups: `~/.openclaw/backups/`.

Measured live on 2026-10-14 after the fixes below: **4.5–5.8 s per turn,
9B at 44 tok/s, no hidden thinking.** Live gauntlet on his real calendar
(`scripts/eval/v3/gauntlet/run.sh`): 12/12 on 2026-10-12.

### Deploying

- Plugin: `scripts/orion-deploy --allow-dirty` (build, every test suite, snapshot,
  install to `~/.openclaw/extensions/orion-control`, gateway restart + probe,
  automatic rollback). Roll back: `scripts/orion-deploy --rollback`.
- Mac app: `native/Orion/make_app_bundle.sh`, then replace `/Applications/Orion.app`
  (keep a copy as `/Applications/.Orion-previous-<build>-<what>`; latest is
  `.Orion-previous-620-todo-redesign`). Build number = `git rev-list --count HEAD`.
- Phone: `xcodebuild -project native/OrionMobile/OrionMobile.xcodeproj -scheme
  OrionPhone -destination 'generic/platform=iOS' -allowProvisioningUpdates build`,
  then `xcrun devicectl device install app --device 00008140-00013C1C213A801C <app>`
  (retry until the phone is unlocked and near the Mac).
- Live tests through the real route: `openclaw agent --session-key <new key>
  --thinking low --message "…"` (binary in `~/.openclaw/tools/node-v24.15.0/bin`).
  Never run the gauntlet while Nick is mid-conversation; tests must never reach
  his real calendar.

---

## Log

### 2026-10-14 — ORION slow and sometimes silent: fixed (Claude)

- **Hidden thinking.** The Mac app's chat sessions carry `thinkingLevel: "low"`
  (its `ThinkingPolicy` only sees the cloud model it picked, not the local one
  the plugin swaps in). The gateway forwards a session thinking level over the
  model's `think: false` unless the model is `reasoning: false`. The 9B thought
  100–250 tokens every turn (15–23 s turns) and twice ran out of `num_predict`
  on 2026-10-13 ("Agent couldn't generate a response"). Fixed: `reasoning: false`
  on the 9B in the live config.
- **Cold models.** Only the 4B was warmed, once at startup; a terminal
  `ollama run` (default keep-alive 5 min) or a different `num_ctx` unloaded them.
  `keepWarm` now keeps both loaded at their real context.
- **Testing window** had closed at 18:04 → cloud model with no credit → silence.
  Renewed to 2026-10-16T20:58:39Z.
- Repo cleanup: stale planning docs, old eval run folders (raw logs/JSON) and
  the old handoffs archived to `~/Desktop/ORION-archive/2026-10-14/`;
  `ORION_V3_HANDOFF.md` → `docs/planning/v3/ORION_V3_SPEC.md`; this file rewritten.
- `docs/learn/` (untracked) is a learning guide another session was writing on
  2026-10-14; it was left alone. Commit it or delete it once that session says
  it is finished.

### 2026-10-13 — To-do list redesign; finished to-dos unbooked (Claude)

- **One shared to-do screen** for the Mac Tasks tab and the phone Plan tab
  (`native/OrionMobile/Sources/OrionViews/Todo*.swift`, logic in
  `MobileCore/TodoBoard.swift` + `TodoQuickAdd.swift`), after Nick's old Notion
  list: views to do / upcoming / by tag / done; Notion-colour priority and tag
  pills (no two tags alike); quick add `essay #school !high fri 5pm` or pills
  under the field; edit in place (title, pill menus, open the row for details,
  spread and parts). Date-only dues are 23:59 with no alarm. Details written with
  no spread are stored as `Notes: …` so neither app nor planner reads them as the
  spread. The Mac's old local-only per-task progress bar is gone (parts carry
  progress).
- **Finished to-dos keep no sessions.** `orion-tasks` records which to-dos it
  booked (`~/.openclaw/orion-controlled/task-sessions.json`); `orion-tasks sweep`
  (run by `orion-watch` every tick and before every plan) drops the upcoming
  sessions of any that are no longer open.
- **Reminders.** "Remind me at 11" was turned into a to-do with an ignored
  `--at` and booked at 17:50. Now: code builds the exact `alarm_set` call through
  `orion_task_run` (the authorization gate is NOT bypassed), a reply without the
  call is retried then replaced, "I've set a…" counts as a claim, `orion-tasks`
  refuses unknown options.

### 2026-10-12 — Local routing live; live gauntlet 12/12 (Claude)

- Root cause of the first local failures: the 9B ran at Ollama's defaults
  (temperature 1, presence_penalty 1.5, thinking on) with a 17k-token prompt.
  Fixed params, slim prompt, the fixed-sequence schedule flow, invisible commutes,
  exact replies, account-health alerts. Details: `docs/evals/v3/LOCAL_FAILURES.md`,
  `docs/evals/v3/RESEARCH_IDEAS.md`, `docs/planning/v3/ORION_V3_IMPLEMENTATION_PLAN.md`.

---

## Open, in order

1. **Anthropic credits** (Nick) — until then nothing cloud works.
2. **Acceptance gate** for local routing: a production-replay eval on his real
   logged requests (research idea #6) so "on" stops depending on a testing window.
3. Research ideas still to build (`docs/evals/v3/RESEARCH_IDEAS.md`): #5 store
   successful turns as examples, #4 propose/preview/commit for schedule changes,
   #8 serving (something sometimes loads `gpt-oss:20b`, 12 GB; consider
   `OLLAMA_MAX_LOADED_MODELS=2` — Nick's call).
4. Voice turns arrive split ("(Continuing — my last message was cut off…)"), one
   full turn per fragment; and ambient speech woke ORION on 2026-10-14
   ("I didn't say anything. Why are you active?"). Worth a look in the Mac app's
   turn-taking.
5. The default 45-minute commute home in the scheduler (Nick's call whether it
   should follow `places.json`).
6. `docs/planning/v2/PHASE_GATES.json` is still the program's phase record; the
   V3 work above is outside the numbered phases.

## Lessons (do not re-learn these)

- Never switch live routing without a real-route test and an API-health check.
- A setting can be right in the config and wrong on the wire: check what Ollama
  actually received (`~/.ollama/logs/server.log`: prompt eval / eval lines) and
  the session transcript (`~/.openclaw/agents/main/sessions/*.jsonl`, look for
  `"type":"thinking"`).
- A different `num_ctx` makes Ollama reload the model; warm with the same one.
- Plugin tests must stub the schedule flow; one test once wrote a block "B4" to
  his real calendar.
- Never rewrite published history (Sparkle build numbers); push by fast-forward.
