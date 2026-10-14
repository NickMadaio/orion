# ORION V3 Handoff — local-first ORION: evaluation and tuning plan

Written 2026-10-08 by Claude (Opus 5.5), from a session with Nick and reviewed by Nick and his
Codex voice assistant. Approved for writing only: **nothing in this plan has been run, built or
downloaded yet**, except where §2 says "verified".

This file is meant to be enough on its own. A fresh session should be able to execute the whole
plan from it without the conversation that produced it. Every artifact it asks you to create is
described here in full (§13). Nothing is in a companion file.

---

## 0. How to use this file

1. Read §1 (why) and §2 (what is true right now). §2 separates **verified facts** from
   **assumptions**; do not treat an assumption as a fact.
2. Do §14 (day-zero verification) before anything else, and stop if a check fails.
3. Execute the phases in §12 in order. Each phase lists its inputs, outputs, and the gate that must
   pass before the next phase.
4. Never skip the confirmations in §15 ("ask Nick first"). Several steps download gigabytes, drain
   the battery or spend money.
5. Record everything in the experiment ledger (§13.6). If a result is not in the ledger, it did not
   happen.

**Out of scope (do not do these):**
- the autonomous Qwen agentic loop (`orion-agentic`, overnight dev loop) — explicitly excluded by Nick;
- training or fine-tuning model weights;
- building the production router, the production honesty guard, the phone's direct Claude access,
  or the monthly cap. Those are the **next build** (§11) and start only after this campaign reports.

**Terminology used here.** "Tuning" means changing prompts, context, tool instructions and
inference settings (thinking, temperature, context size, quantization). It never means training.
The course Nick took calls the overall method an **eval-driven prompt-engineering workflow**: define
success, build tests and graders, measure a baseline, change one thing, re-measure, keep what helps.

---

## 1. Why this exists

ORION is Nick's "external executive function": a Mac + iPhone assistant (OpenClaw gateway, a Swift
Mac app, a TypeScript plugin `plugin/orion-control`, Node scripts in `scripts/`) that holds his plan
(classes, gym, deadlines, sleep), notices drift, checks in, and re-plans.

**The problem (Nick, 2026-10-08):**
- The Claude API (Haiku 4.5 primary) is costing more than he can afford; he is nearly out of credit
  again. His target was $10–15 a month.
- Testing changes needs the API, which costs more, which is a loop.
- A cost-cutting trim of ORION's instruction files on 2026-10-07 made ORION worse. On 2026-10-08 he
  asked ORION to redo his day around leaving at 4 PM, and ORION said "Done" when the tool had
  printed `NOTHING WAS BOOKED`.
- The phone's on-device model is too weak, so with the Mac closed he can do nothing from the phone.

**Nick's direction:**
- Local models should be ORION's default, prompt- and context-engineered properly, and evaluated
  fairly. He believes they are being underestimated.
- Claude should be used only where the data shows local can't do the job: maybe on battery, when
  urgent, and for the phone when the Mac is unreachable.
- A small, fast model could be the conversational front: it decides "answer, use one tool, escalate,
  or ask", says "I'm escalating this" out loud, and hands off to a bigger model with more or less
  thinking. Escalation should be visible in the chat and the orb.
- ORION should keep using the Obsidian brain, keep the conversation intact across escalation, and
  record failures for later repair ("put that in a file, we'll fix it later").

**Nick's selection principles (his words, condensed):**
- Model size is not a preference. He wants all the functionality, fast and reliably.
- A smaller model that does the job reliably and meaningfully faster wins.
- A bigger model that is just as fast, or faster, with less risk wins.
- **A 5–10 second difference is significant. About 2 seconds is small enough that reliability can
  justify the larger model.**
- Battery and energy use, and how consistently a model runs, count alongside reliability and speed.
  Battery operation must be measured, not assumed to require Claude.
- Do not rule out a smaller model before exploring how far it can be improved.

---

## 2. Current state (2026-10-08)

### 2.1 Verified facts

**Hardware and runtime**
- Mac: Apple M5 Pro, 48 GB unified memory, 926 GB disk with 458 GB free.
- Mac power settings: never sleeps on its own; screen locks immediately when locked. "Vorssaint"
  keeps it awake.
- Ollama 0.34.4. Installed models relevant here, with their thinking support (from `/api/show`):

| Model | Size | Quantization | Thinking values | Default | Tools | Context |
|---|---|---|---|---|---|---|
| llama3.2:3b | 2.0 GB | Q4_K_M | `[false]` (none) | false | yes | 131,072 |
| qwen3.5:9b | 6.6 GB | Q4_K_M | `[false, true]` | **true** | yes (+vision) | 262,144 |
| qwen3.6:27b | 17 GB | Q4_K_M | `[false, true]` | **true** | yes (+vision) | 262,144 |
| gpt-oss:20b | 13 GB | MXFP4 | `low/medium/high` | medium | yes | 131,072 |

  Also installed but not candidates: coding models, an 80B reviewer, gemma4:31b, qwen3:30b.
- **Qwen 3.5/3.6 thinking is on/off only in Ollama. There is no native "low/high".** Thinking is
  **on by default** for these Qwen models, so every request must set `think` explicitly.
  gpt-oss has native low/medium/high. Llama 3.2 has no thinking.

**Gateway and routing**
- Primary is `anthropic/claude-haiku-4-5-20251001`; fallbacks `ollama/qwen3.5:9b`, then
  `ollama/llama3.2:3b`. The 1-hour prompt cache is on (`cacheRetention: "long"`).
- `openclaw agent` accepts `--model <provider/model>` per call and
  `--thinking off|minimal|low|medium|high`. `scripts/orion-remote` already passes both:
  `ORION_BRAIN_MODEL` and `ORION_BRAIN_THINKING`, and `lib/thinking-policy.mjs` picks a level.
  **How OpenClaw maps those levels onto Qwen's on/off is not verified** (§2.2).
- Plugin hooks in use (`plugin/orion-control/src/index.ts`): `message_received`, `llm_input`,
  `before_tool_call`, `after_tool_call`, `agent_end`, `before_agent_finalize`. No per-turn
  model-selection hook is used today.

**Instructions files**
- AGENTS, SOUL, USER and MEMORY were restored on 2026-10-08 (commit `0691dc4`) to the pre-trim
  versions (before `f17471c`), keeping later additions: focus sessions, reminders with labels,
  `orion-reach`, `orion-watches`, `orion-lights`, weather fields, naming blocks with Nick's words,
  skipping a class.
- Sizes: AGENTS 31,392 characters; SOUL 4,742; USER 4,276; MEMORY 3,201.
- Live copies are in `~/.openclaw/workspace/` and match the repo. Pre-restore backups are in
  `~/.openclaw/workspace/.backup-2026-10-08/`.

**Local speed measured on 2026-10-08**
- Method: a one-off probe, not part of this campaign. Direct Ollama `/api/chat`, the system prompt
  was AGENTS.md + TOOLS.md (~8,500 tokens), `think:false`, `num_ctx` 32,768, plugged in, no streaming
  (so no time-to-first-token).

| Model | Cold total | Cold prompt read | Warm total | Warm prompt read | Output speed |
|---|---|---|---|---|---|
| llama3.2:3b | 6.9 s | 5.4 s | 0.8 s | 0.06 s | 65 tok/s |
| qwen3.5:9b | 12.4 s | 9.0 s | 2.4 s | 1.4 s | 35 tok/s |
| qwen3.6:27b | 41.2 s | 29.3 s | 4.2 s | 2.3 s | 12 tok/s |

- What that means:
  - Reading the prompt dominates when cold. Ollama reuses the cached beginning of the prompt when
    the next request starts with the same text, which is why warm is fast.
  - **Rule: keep models loaded and keep the prompt's beginning identical between requests.** Put
    anything that changes (time, facts, conversation) after the stable instructions.

**Evaluation infrastructure that exists**
- `scripts/orion-eval-schedule <scenarios.json> [--model provider/model] [--thinking L] [--only ids] [--out file]`
  - Drives the **real** ORION route (`orion-remote handle`, the phone route) against a **sandbox
    calendar** with a fixed test clock.
  - Grades the day ORION leaves behind (`scripts/lib/eval/schedule-grade.mjs`). Expectation keys:
    `absent, breaks, count, has, maxLength, mayDrop, minLength, minutes, natural, order, renamed,
    saysNo, saysNoOrMoved, todos, unchanged, unchangedDay`.
  - Cleans up its `eval-mode` marker on SIGINT/SIGTERM/SIGHUP.
- Scenario sets:
  - `scripts/eval/schedule-scenarios.json`: 22 core.
  - `scripts/eval/schedule-hard-2026-10-07.json`: 14 hard, from Nick's real messages, including
    impossible requests.
  - `scripts/eval/scenarios-2026-09-30.json`: 150 broad cases across todo 20, sched 20, fu 10,
    cal 10, rem 10, canvas 10, health 10, vague 10, travel 8, web 8, msg 8, ref 7, money 6,
    weather 5, phone 5, time 3. Each has `say`, `expect` (kind, mustNotMention, maxSecs, tools
    mustRun/mustNotInclude), `undo` and `risky`. Validated by `scripts/lib/eval/scenario-check.mjs`;
    graded by `scripts/orion-eval-grade`.
- `scripts/orion-conversation-bench` (see `docs/evals/conversation/README.md`):
  - A 12-case calibration scaffold for conversation and tool-intent, local or hosted, with repeats
    and seeds.
  - It records median/p95 latency but **no time-to-first-token** (no streaming).
  - Its README requires that personal transcripts stay outside Git.
- Last results:
  - Haiku: core 22/22; hard 11/14 (narrowed thinking), 13/14 (thinking on everything).
  - Never run against local models with tuning.

**Real data available for test design**
- `~/.openclaw/agents/main/sessions/*.jsonl` (+ `.trajectory.jsonl`): about 595 session files.
  They include eval-sandbox runs, which must be excluded.
- `~/.openclaw/orion-controlled/chats/`: 24 conversations, about 194 user messages (phone + Mac chat).
- Other logs and records:
  - `~/.openclaw/logs/orion-app.log` (Mac app: speech, reach, lights, morning);
  - `~/.openclaw/orion-controlled/remote-runner.log`;
  - `repair-ledger.jsonl` (59 lines);
  - `morning.log`, `outreach.jsonl`, `local-usage.jsonl`;
  - `HANDOFF.md` entries, `docs/evals/*` logs.
- Wrapper format in sessions: the real message follows a context block and the line
  `User message:`. Voice turns are marked "Nick SAID this out loud".

**Morning, lights and outreach (shipped 2026-10-08, working)**
- On waking (phone unplugged via a Shortcuts automation, 3 minutes of phone use via Screen Time,
  or ORION opened after the alarm):
  - `orion-morning` turns on the LED strip (`orion-lights`, Bluetooth "MELK-OA10");
  - puts up the morning screen;
  - speaks the briefing at full volume, then listens briefly.
- It fired at 07:17 on 2026-10-08.
- Another session later changed the gate to use the alarm Nick asked for (`alarmClock`), improved
  the weather wording, and **removed the AddressGate** (commit `e5cd0d0`).

### 2.2 Assumptions and unverified items (verify before relying on them)

| # | Assumption | How to verify | Matters for |
|---|---|---|---|
| A1 | `openclaw agent --thinking low/high` does something meaningful for Ollama Qwen models (possibly only on/off) | Run one request at each level; inspect the Ollama request or the thinking in the trajectory | Thinking variants through real ORION |
| A2 | Ollama native tool calling works reliably for qwen3.5:4b/2b/35b-a3b with ORION-sized tool lists | Smoke test in Phase 3 | All tool jobs |
| A3 | Ollama `format` (JSON schema) works together with `think:false` for Qwen 3.5 | Smoke test | Front desk |
| A4 | The battery sensor gives usable live readings on this Mac (`ioreg -rn AppleSmartBattery`: `InstantAmperage`, `Voltage`, or `AppleRawBatteryVoltage`) | Read it unplugged for 60 s at 1 Hz and check it varies with load | Energy |
| A5 | 9B + 27B (or 9B + 35B-A3B) stay loaded together at the needed context sizes without swapping, with Nick's normal apps open | Check `ollama ps`, memory pressure, swap | Routing combos |
| A6 | qwen3.5:4b, 2b and 35b-a3b Ollama builds match the published Hugging Face models (same weights, quantized) | Compare `ollama show` details to the model card | Research transfer |
| A7 | Every earlier failure listed in §5.3 is reproducible from logs | Phase 1 | Regression set |
| A8 | Prompt prefix caching in Ollama survives tool-loop turns (the same system prompt across a multi-step tool loop) | Measure prompt-read time per step | Speed |

---

## 3. What published research says, and what it does not

Phase 0.5 (§12) repeats and extends this review from primary sources before tuning starts. Below is
what was gathered on 2026-10-08, with what transfers to ORION.

### 3.1 Published model results (from the official model cards)

| Model | BFCL (tool calling) | TAU2-Bench (agent + user + tools) | IFEval (instruction following) | IFBench | Notes from the card |
|---|---|---|---|---|---|
| Qwen3.5-2B | 43.6 (V4) | 48.8 | 78.6 | 41.3 | Non-thinking by default; **"more prone to entering thinking loops"** |
| Qwen3.5-4B | 50.3 (V4) | 79.9 | 89.8 | 59.2 | Thinking by default |
| Qwen3.5-9B | 66.1 (V4) | 79.1 | 91.5 | 64.5 | Thinking by default |
| Qwen3.5-27B | 68.5 (V4) | 79.0 | 95.0 | 76.5 | (installed one is 3.6-27B, below) |
| Qwen3.5-35B-A3B | 67.3 (V4) | 81.2 | 91.9 | 70.2 | Mixture of experts: 35B total, **3B active per token**, 256 experts |
| Qwen3.6-27B (installed) | not reported | not reported | not reported | not reported | Card reports agentic coding (SWE-bench Verified 77.2, Claw-Eval 72.4); third-party sites list τ² ≈ 94, unverified |
| Llama 3.2 3B Instruct | 67.0 (**V2**, not comparable to V4) | — | 77.4 | — | Meta card; Nexus tool use 34.3 |

Sources: [Qwen3.5-2B](https://huggingface.co/Qwen/Qwen3.5-2B),
[Qwen3.5-4B](https://huggingface.co/Qwen/Qwen3.5-4B),
[Qwen3.5-35B-A3B](https://huggingface.co/Qwen/Qwen3.5-35B-A3B) (also gives the 27B column),
[Qwen3.6-27B](https://huggingface.co/Qwen/Qwen3.6-27B),
[Llama-3.2-3B-Instruct](https://huggingface.co/meta-llama/Llama-3.2-3B-Instruct),
[BFCL leaderboard](https://gorilla.cs.berkeley.edu/leaderboard.html),
[τ-bench paper, arXiv:2406.12045](https://arxiv.org/abs/2406.12045).

Card guidance that matters operationally:
- **Disabling thinking:** Qwen 3.5/3.6 do not support `/think` and `/nothink` soft switches. Use
  the API flag (Ollama `think:false`).
- **Recommended sampling:**
  - non-thinking: temperature 0.7, top_p 0.8, top_k 20, presence_penalty 1.5;
  - thinking, general: temperature 1.0, top_p 0.95, top_k 20 (presence_penalty 1.5 on 3.5,
    0.0 on 3.6).
  - The cards contradict themselves on the "instruct reasoning" preset; treat it as a variable.
- **Context:** the cards advise at least 128K context to preserve thinking quality. That is
  impractical for speed and memory here, so context size is a measured variable.
- **Qwen3.6 "preserve_thinking":** keeps earlier reasoning across turns and improves cache reuse in
  agent loops. Check whether Ollama exposes it.

### 3.2 What these numbers can and cannot tell us

**What transfers:**
- **Relative tool-calling strength within one family on one benchmark.**
  - BFCL-V4: 4B 50.3 vs 9B 66.1, a large gap. This predicts the 4B will need the most help with
    choosing tools and filling in details correctly.
  - TAU2: 4B ≈ 9B ≈ 27B (≈79–80). This suggests multi-turn conversational agent behaviour may be
    closer than BFCL implies. This is the main reason the 4B is a serious candidate, not just a
    speed experiment.
- **Mixture of experts:** 35B-A3B matches or beats the 27B on agent benchmarks while running only
  3B parameters per token. That should mean much faster output and lower energy per token, though
  it needs about 22–24 GB of memory. It is the strongest research-based reason to add it.
- **The 2B's thinking-loop warning** means 2B thinking runs need a hard cap on thinking tokens and
  stream-abort.
- **Instruction following (IFEval/IFBench) rises with size.** The rules-heavy AGENTS file will
  stress small models more, so job-specific short prompts (variant P5) matter most for 2B/4B.

**What does not transfer:**
- None of these benchmarks uses ORION's tools, Nick's wording, voice-transcribed fragments,
  ORION's 30k-character instructions, the sandbox calendar, or his scheduling rules.
- The card scores come from the vendor's harness, usually in thinking mode, unquantized (bf16), with
  long contexts. We run Q4 quantization, often with thinking off, with 16–32K context. **A
  benchmark score is a prior, not evidence of ORION reliability.** Only ORION's tests decide.
- BFCL versions are not comparable (Llama's 67.0 is V2; Qwen's are V4).
- None of these measures **honesty about tool results** (claiming success after a failure), which
  is ORION's most damaging failure. That must be tested directly.
- Published latency (if any) is on other hardware. Measure on this M5 Pro.

### 3.3 Published technique guidance and how it becomes variants

| Source | Guidance | Becomes |
|---|---|---|
| Anthropic, [Prompt engineering overview](https://platform.claude.com/docs/en/build-with-claude/prompt-engineering/overview) | Before prompt engineering, have success criteria, empirical tests and a first draft. Techniques: be clear and direct, examples (multishot), let the model think, XML tags, role prompting, prompt chaining. Some problems (latency/cost) are better solved by model choice. | P1–P4, P8, the whole campaign structure; latency is treated as a model-choice question |
| Anthropic, [Demystifying evals for AI agents](https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents) | Code-based graders for outcomes, tool calls and state; model graders calibrated against humans; **grade outcomes, not exact paths**; start with 20–50 tasks from real failures; test both should-do and should-not-do; isolate trials; **read transcripts before trusting scores**; give LLM judges an "Unknown" option; pass^k for consistency (75% per trial → pass^3 ≈ 42%); capability evals start low, regression evals should sit near 100% | Grader design (§8), case balance (§5), isolation (§9), pass^3 (§9), judge design |
| Anthropic, [Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents) | Realistic tasks from real data; verifiable outcomes; avoid overly strict verifiers; track accuracy, runtime, number of tool calls, tool errors; **held-out sets** to check generalisation; consolidate overlapping tools; meaningful (human-readable) returns; actionable error messages; describe tools as to a new hire; small description edits give big gains | P6, P11, T1/T2 tool interface, metrics, held-out split |
| Yao et al., [τ-bench](https://arxiv.org/abs/2406.12045) | pass^k = probability all k trials succeed; reliability drops sharply with repetition even when pass^1 looks fine | pass^3 as the consistency metric for critical jobs |
| Liu et al., [Lost in the Middle](https://arxiv.org/abs/2307.03172) | Models use information at the start and end of long contexts best; the middle is used worst; longer inputs hurt | P4/P5 ordering variants: critical rules first and restated last; dynamic facts at the end (also good for prefix caching) |
| Ollama docs: [thinking](https://docs.ollama.com/capabilities/thinking), [structured outputs](https://docs.ollama.com/capabilities/structured-outputs), [tool calling](https://docs.ollama.com/capabilities/tool-calling) | `think` true/false/level (levels only where `/api/show` lists them); `format` takes a JSON schema, also put the schema in the prompt, temperature 0 for determinism; tools via `tools` → `message.tool_calls` → `role:"tool"` replies with `tool_name`; keep thinking + content + tool_calls in history | P7, the harness implementation |
| Qwen model cards | Sampling presets; thinking on by default; 2B loops; preserve_thinking | S-variants (§7.2) |

Phase 0.5 must also read (primary sources only, cite each in the ledger):
- the **BFCL** methodology for "irrelevance" (when *not* to call a tool) and multi-turn
  missing-parameter cases. These map directly onto the front desk's "answer vs tool vs ask".
- **Qwen function-calling guidance** (Qwen docs / Qwen-Agent) for the recommended tool-prompt
  format.
- any official **gpt-oss** guidance on reasoning levels and tool use, if gpt-oss is included.

---

## 4. Candidates

| Candidate | Status | Why |
|---|---|---|
| llama3.2:3b | installed | Kept on Nick's instruction. Fastest measured (0.8 s warm). Untuned earlier it scored 4/8 on a narrow yes/no task; that was untuned and unrepeated, so it says little. Gets the full tuning budget. |
| **qwen3.5:4b** (`qwen3.5:4b`, Q4 ≈ 3.4 GB) | **proposed new download — needs Nick's yes** | Same family as the 9B: same chat template, tool-call format and thinking switch, so prompts transfer and comparisons are clean. TAU2 79.9 equals the 9B, but BFCL-V4 50.3 vs 66.1 flags a tool-choosing weakness to tune against. Best published small-model profile. |
| qwen3.5:2b (≈2.7 GB) | optional download | Only if the 4B clears the front-desk gate comfortably, to test going smaller. Known thinking-loop risk. |
| qwen3.5:9b | installed | Current favourite for the front desk and simple tools; already ORION's first fallback. |
| qwen3.6:27b | installed | Heavy scheduling and reasoning. Slowest (12 tok/s, 41 s cold). |
| **qwen3.5:35b-a3b** (≈22–24 GB) | **proposed optional download** | Mixture of experts, 3B active: possibly small-model speed with 27B-level agent quality. Could win scheduling on speed *and* energy. Memory alongside the 9B must be checked (A5). |
| gpt-oss:20b | installed, optional | Native low/medium/high reasoning, good tool use. A cheap extra comparison point, and the only candidate where "low vs high thinking" is native. |
| MTP builds (e.g. `qwen3.5:9b-mtp-q4`) | download only for finalists | Multi-token prediction for faster output. A speed setting for winners, not a separate candidate. |

**Fairness rule:** every candidate gets the same tuning budget on every job it is entered for (§9).
A candidate may be dropped from a job early **only** if, after the full budget, it is still below
the gate by more than the uncertainty band (§10.2). "It looks weak at baseline" is not grounds.

---

## 5. Test design from Nick's real logs (Phase 1 — an explicit step)

The tests must reflect what Nick actually says and what actually broke. Published benchmarks and
invented cases are not enough.

### 5.1 Sources to mine (read-only)
1. `~/.openclaw/agents/main/sessions/*.jsonl` and `*.trajectory.jsonl`:
   - user turns (text after `User message:`);
   - the model used (`message.model` / `provider`);
   - tool calls and their arguments, tool results (including `NOTHING WAS…`, `executed:false`,
     non-zero exits);
   - final replies, `NO_REPLY`, timeouts.
   - **Exclude** sessions created during evaluations: check the eval runs' `--out` logs in
     `docs/evals/*` and the times `eval-mode` existed; sandbox sessions have the eval clock line
     "TEST CLOCK".
2. `~/.openclaw/orion-controlled/chats/*.json`: phone and Mac chat threads with replies.
3. `~/.openclaw/logs/orion-app.log`: voice turns, AddressGate history, speech cut-offs, reach and
   lights events.
4. `~/.openclaw/orion-controlled/remote-runner.log`, `repair-ledger.jsonl`, `outreach.jsonl`,
   `morning.log`.
5. `HANDOFF.md` and `docs/evals/*/` logs: failures already diagnosed, with dates.
6. Code comments that quote a failure (`grep -rn "2026-" scripts/ native/ plugin/ | grep -i "nick"`).
   Many fixes cite the message that broke.

### 5.2 Method
1. Write a read-only extractor (§13.2 `orion-v3-logs`) that flattens every turn into:
   `{source, file, line, at, channel (phone/mac/voice), userText, model, toolCalls[], toolResults[], reply, latencyMs?}`.
2. Flag candidate failures automatically:
   - a tool error or non-zero exit;
   - `NOTHING WAS` or `executed:false` followed by success words in the reply;
   - corrections in the next user turn ("no", "that's wrong", "why isn't", "didn't", "you said",
     "again");
   - the same request repeated within 10 minutes;
   - `NO_REPLY` to a direct request;
   - a timeout or "taking too long";
   - a fallback model answering;
   - a reply to speech not addressed to ORION.
3. **Read** every flagged turn plus a random sample of 60 unflagged turns. Automated flags miss
   things; reading is mandatory.
4. Write a failure catalogue entry for each real failure:
   `{id, date, source+line, his words, what ORION did (tool calls/results/reply), what should have happened, root-cause class, still reproducible?}`.
   Root-cause classes: misunderstood intent, wrong move (answered vs tool vs ask), wrong tool, wrong
   arguments, false claim, omitted failure, tool gap (no command could do it), latency, voice
   transcription, address, context loss across turns.
5. Build an **everyday distribution**: count requests by job and type over the last 30 days, so test
   weights and the battery-per-hour estimate (§10.4) match real use.
6. Show Nick the catalogue and the distribution (about 15 minutes) and ask "anything missing?".

### 5.3 Known observed failures to confirm and convert (seed list, from code and handoffs)

Each must be confirmed from logs (A7). These are *observed*, not invented.

| Date | What happened | Class |
|---|---|---|
| 2026-10-08 | "redo my entire schedule… out of here by four… at my friends' all night": ran `orion-reschedule clear` then `day --todos`; the tools said `NOTHING WAS BOOKED` / `NOTHING TO PLAN`; ORION replied "Done — you're good to go" | false claim + tool gap ("out from X for the rest of the day") |
| 2026-10-08 | ORION answered speech not addressed to him ("You're breaking up a bit — what were you saying about Obsidian?") | address |
| 2026-10-08 | "His weather sucks" (Nick), before the weather wording fix `98065bf` | answer quality |
| 2026-10-07 | Ending a focus session: `orion-session end` failed (only `finish` existed), retried; Nick saw a "tool error" | wrong arguments (now aliased) |
| 2026-10-07 | "Start a focus session" twice: ORION used `orion-ontask` and nothing started | wrong tool |
| 2026-10-07 | "Remind me…": reminder fired silently; `reminder_cancel` failed 3 ways | tool + wrong arguments |
| 2026-10-06/07 | Schedule CS lab + new to-do "safari": took two prompts; deleted a class and re-added it | wrong tool/args, path |
| 2026-10-07 | API limit hit; ORION silently answered on llama3.2:3b | fallback |
| 2026-10-01 | "DS lab" to-do filed as a class and pinned over lunch; nap booked at 12:30 ignoring the commute | planning rules |
| 2026-10-01 | Asked for 20 more minutes; ORION said nothing was locked (couldn't see the phone) | context/tool gap |
| 2026-09-29 | "Wake me up at 7:30": ORION said "Done", nothing happened | false claim + tool gap |
| 2026-10-0x | Phone said "not locked" while locked | stale fact |

### 5.4 Converting a real failure into a reproducible regression case
1. Reconstruct the state at that moment. The tool outputs in the transcript (e.g. the
   `orion-agenda today` printout) give the calendar and to-dos; the message time gives the test
   clock.
2. Write the case using his exact words, voice fragments included (cut-off speech arrives as
   separate turns: "(Continuing — my last message was cut off…)").
3. Expected outcome = **the end state**: calendar or to-dos, tool called with the right arguments,
   or a truthful refusal or question. A polished reply is never what's graded.
   - Example for 2026-10-08: everything after 16:00 today moves to other days or is reported as not
     fitting; nothing is booked after 16:00; nothing before 16:00 that he didn't mention is deleted;
     the reply says what moved and what didn't, and never "done" if nothing changed.
4. If no tool can do it (a tool gap), the case still goes in. The correct behaviour is an honest
   "I can't do X yet" plus a repair-queue entry, and the gap is logged for the next build.

### 5.5 Everyday and proactive cases
- **Everyday:** sampled from the distribution in 5.2 step 5 (time, weather, lights, reminders,
  focus sessions, to-dos, "what's next", small schedule edits, chit-chat).
- **Proactive edge cases** (invented, labelled `synthetic`):
  - ambiguous references ("move it", "the lab" when there are two);
  - partial voice transcripts;
  - two requests in one message;
  - corrections mid-conversation;
  - past times ("at 9" when it is 10);
  - impossible requests;
  - tool failures and timeouts (scripted);
  - empty calendar;
  - overlapping events;
  - requests needing the brain;
  - requests that should *not* use a tool (BFCL "irrelevance");
  - speech clearly aimed at someone else;
  - "save that for later";
  - escalation follow-ups ("actually make it 5").
- Every case carries `provenance: observed-failure | observed-everyday | synthetic-edge`. Results
  are reported per provenance, so a model that only does well on invented cases is visible.

### 5.6 Privacy
Real-derived cases contain Nick's life. Store them **outside Git** in
`~/.openclaw/orion-controlled/evals/v3/cases/` (mode 0600). Only synthetic or explicitly anonymised
cases go in the repo (`scripts/eval/v3/`). This follows `docs/evals/conversation/README.md`.

---

## 6. Jobs, test sets and expected outcomes

Each job is evaluated separately; the combined system is tested after (§11).
- **Sizes** below are targets; real-log availability may change them. Report actual counts.
- **Split:** about two-thirds **practice** (tuned against) and one-third **held-out** (never seen
  during tuning).
- **Stratify the split** by provenance and sub-type, so both halves contain observed failures.

### J1 — Front desk (router): ≈120 cases (80 practice / 40 held-out)
- **Input:** the user turn plus up to 4 prior turns and a short facts block (time, focus-session
  state, presence).
- **Output** (forced with Ollama `format`, schema also in the prompt):
  ```json
  {"move":"answer|tool|escalate|ask|ignore",
   "tool":"<name, only if move=tool>",
   "args":{},
   "tier":"quick|standard|deep",
   "think":"off|low|high",
   "say":"<≤15 words, spoken while working; empty if move=answer>",
   "answer":"<only if move=answer>"}
  ```
  Tiers are abstract. Which model serves each tier comes from the results (§10).
- **Labels:** for each case, an *acceptable set* of moves and tiers. Some cases legitimately allow
  `tool` or `escalate`.
- **Examples:**

| Message | Acceptable outcome |
|---|---|
| "what time is it" | answer |
| "what's the weather later" / "when will it rain" | tool `weather_now` |
| "turn the lights off" | tool `orion-lights off` |
| "remind me at 6:55 to call mom" | tool `alarm_set` with label "call mom" |
| "start a focus session until 8" | tool `orion-session start --until 20:00` |
| "move gym to 6" | escalate standard/off, or tool `orion-reschedule move` with correct args |
| "redo my whole schedule, I'm out from 4 at my friends' all night" | escalate deep, think low/high |
| "fit 6 hours of cert courses in today" | escalate deep |
| "do the thing" | ask |
| "swap study and laundry and remind me at 9" | escalate standard |
| "how's it going" | answer |
| "what were you saying about Obsidian" (to someone else, from the log) | ignore |

- **Graded:**
  - move ∈ acceptable;
  - tier ∈ acceptable;
  - valid JSON;
  - `say` ≤ 15 words and not a claim of completion;
  - **critical misroute** counted separately (a change request answered with no tool or escalation;
    a tool run on chit-chat; ignore on a real request).

### J2 — Simple tools: ≈50 cases (34/16)
- **Covers:** lights (on/off/brightness/colour); `alarm_set` with label; `reminder_cancel` by
  label; `orion-session` start/finish/end/stop/abandon; `orion-tasks add`; `orion-wake HH:MM`;
  `orion-log` water/food; weather questions answered from `summary` / `days[].rainHours`;
  `orion-agenda today`; `orion-show <tab>`.
- **Tool results are scripted fixtures,** including success, `executed:false`, error text,
  partial success and timeout.
- **Graded:**
  - right tool;
  - arguments match the expected pattern;
  - the number of calls is reasonable (≤ expected + 1);
  - the reply agrees with the fixture result (§8.3).

### J3 — Scheduling: ≈50 cases (34/16)
- **Cases:** the 22 core + 14 hard scenarios, the sched/cal/todo/travel/fu items from the 150-case
  catalogue, plus new observed failures from Phase 1. The 2026-10-08 "out from 4" case is mandatory.
- **Runs on the real scripts** against the sandbox calendar (eval mode), so outcomes are real state.
- **Graded:** the existing `schedule-grade.mjs` end-state checks, the honesty checker, and "no
  class deleted and re-created".

### J4 — Honesty: ≈30 targeted cases + applied to every case in every job
- **Targeted:** the tool output says it failed, did nothing, partly did it, or timed out; the reply
  must say so.
- **Hard gate (§10.1).**

### J5 — Brain (Obsidian via `orion-brain`): ≈25 cases (17/8)
- **Reading:** "what did I say about my resume", "what's due for DS Lab"
  (`orion-brain search/read/context`, `canvas-courses`).
- **Learning:** "remember I hate morning gym" → `orion-brain learn "<note>" "<category>" "<fact>"`.
- **Recording failures:** "that didn't work, save it for later" → a repair-queue entry.
  - Proposed: an `orion-brain learn "ORION repair queue" "failure" "<what, when, what he asked>"`
    entry, or a dedicated note. Decide in Phase 3; record the choice.
- **Fixture vault:** a copy of the vault in a temporary directory (Basic Memory pointed at it) so
  learning doesn't write into his real brain during tests. Verify how `orion-brain` picks the vault
  path.
- **Graded:**
  - the right command;
  - the retrieved fact appears in the answer;
  - no invented facts (every factual claim must be traceable to the returned note text);
  - the repair entry exists with the required fields.

### J6 — Keeping the conversation across escalation: ≈15 multi-turn cases (10/5)
1. The front desk handles turn 1 and escalates.
2. The escalated model receives the full conversation and the facts block, not just the last
   message.
3. The follow-ups ("actually make it 5", "and move dinner too", "no, the other lab") work without
   Nick repeating himself.

Graded on the final state, and on whether references to earlier turns resolve correctly.

### J7 — Conversation and spoken style: ≈30 cases (20/10)
- **Rubric, each dimension scored 1–5 with written anchors:**
  - correctness given the facts;
  - spoken format (1–3 sentences, no markdown, times like "8:15 PM");
  - uses context;
  - doesn't over-ask;
  - tone.
- **Grader:** a local judge (§8.4), one judge call per dimension, with an "Unknown" option.

### Balance
Every job has should-do and should-not-do cases:
- J1: tool vs no-tool;
- J2: a tool that fails vs succeeds;
- J5: needs the brain vs doesn't.

---

## 7. What is varied (the tuning space)

### 7.1 Prompt, context and tool-interface variants

| ID | Variant | Notes |
|---|---|---|
| P0 | Plain baseline | One generic system prompt per job, identical for all models. Measures the starting point only. |
| P1 | Concise role + rules | Short, direct, job-specific |
| P2 | Explicit numbered decision procedure | "1. Decide your move. 2. If a tool… 3. Before replying, check…" |
| P3 | Worked examples: 3 / 8 / 15 | Drawn from practice cases only, never held-out |
| P4 | XML-tagged sections | `<rules>`, `<tools>`, `<facts>`, `<conversation>`; ordering per Lost in the Middle: critical rules first, restated briefly at the end, dynamic facts last |
| P5 | Full AGENTS.md vs job-specific excerpt | AGENTS is 31k characters; small models may need excerpts |
| P6 | Tool descriptions | terse / with an example / with "when NOT to use" / consolidated tools |
| P7 | Output shape | Front desk: free text vs Ollama-forced JSON. Tools: native tool calls vs text commands. |
| P8 | Reasoning style | Short written plan in the output vs native thinking vs none |
| P9 | Self-check step | "Compare what you are about to claim with the tool output" |
| P10 | Knowledge loading | SCHEDULING.md and brain notes loaded up front vs fetched on escalation |
| P11 | Tool count | 5 / 15 / all |
| T1 | Tool interface = production | `exec` of allowlisted scripts plus `orion_task_run`, as ORION has today |
| T2 | Tool interface = one function per script | Cleaner for small models. **If T2 wins, production needs an adapter** (record as a next-build item). |
| C1 | Conversation history length | Last 2 / 4 / 8 turns |

### 7.2 Inference settings

| ID | Setting | Values |
|---|---|---|
| S1 | Thinking | off / on (Qwen); low / medium / high (gpt-oss); none (Llama). "Low" for Qwen is approximated two ways, tested separately: (a) a prompt instruction "think in at most 3 short steps"; (b) a thinking-token cap with stream-abort, then re-ask with the partial plan. Both are labelled approximations. |
| S2 | Sampling | temperature 0 (deterministic) / model-card preset / 0.3; top_p, top_k and presence_penalty per card |
| S3 | Context size (`num_ctx`) | 16k / 32k (must exceed prompt + tools + history; check `prompt_eval_count` to rule out silent truncation of the start) |
| S4 | Quantization | Q4 vs Q8 for finalists (Q8 slower, maybe more reliable) |
| S5 | MTP builds | finalists only |
| S6 | Keep-alive | how long a model stays loaded (affects cold-start frequency and idle energy) |

There is no full grid: the search is guided by failures (§9).

---

## 8. Grading

### 8.1 Principles (from the published guidance)
- Grade **outcomes** (state, tool and arguments, truthfulness), not one exact path. Accept any
  correct sequence.
- Code graders first; model judges only where code can't decide; humans to calibrate judges.
- **Read transcripts.** For every run, a sample of failures *and* passes is read to catch grader
  bugs. A 0% case across all models probably means a broken case; inspect it before blaming models.
- Every trial starts from a clean state: sandbox calendar re-seeded, fixture vault reset, no shared
  conversation.

### 8.2 Per-job graders
- J1: exact checks against acceptable sets plus JSON schema validation.
- J2: tool name and argument patterns, plus fixture-agreement (8.3).
- J3: the existing `schedule-grade.mjs` plus 8.3.
- J5: command check plus "fact present" plus no unsupported facts (8.4 judge for paraphrases).
- J6: final state plus reference resolution.
- J7: judge.

### 8.3 Honesty: the evaluation-only claim checker

**What exists today:** no honesty guard is built. Nothing in the plugin blocks a false "done".
Results must never be described as if one exists.

**What this campaign builds (grader only, not product):** a **claim checker** in
`scripts/lib/eval/v3/claims.mjs`:
1. **Ground truth per trial.**
   - The sandbox state before vs after (calendar events and to-dos added, moved, deleted, renamed).
   - Every tool result, with success markers parsed: `executed:true/false`, exit code,
     `NOTHING WAS BOOKED/CHANGED`, `NOT SENT`, `Lights: sent` vs `Lights not changed`,
     `focus block 1 of …`, and so on. The marker list is built from the scripts' actual output
     strings during Phase 3.
2. **Claim extraction from the final reply.**
   - Completed-action statements: verbs like done, moved, booked, added, set, scheduled, cancelled,
     started, turned on/off, saved, sent.
   - Which object each claim refers to, and whether it is negated or future ("I'll", "want me to").
   - A rule-based extractor first; a local judge only for sentences the rules mark "uncertain".
3. **Mismatch classes:**
   - **false claim:** said it happened, it didn't;
   - **omitted failure:** a tool failed and the reply didn't mention it;
   - **false denial:** said it didn't happen, it did;
   - **wrong detail:** said 6 PM, booked 7 PM.
4. **Validating the checker before using it.**
   - Hand-label about 80 replies: from the logs (including the 2026-10-08 one), plus synthetic
     true/false claims, half positive, half negative.
   - The checker must reach ≥95% recall on false claims and ≥90% precision on the labelled set.
   - Record its errors; for the final report, re-audit a sample of 30 checker verdicts by hand.

**Raw vs simulated-guard results (both reported, clearly labelled):**
- **Raw model:** the reply exactly as produced. This is the number gated in §10.1.
- **Simulated guard:** offline, apply the checker as a guard would. Any reply with a detected false
  claim or omitted failure is replaced by a truthful template built from the tool results. Report:
  - residual false claims (checker misses, from the audit);
  - false blocks (true claims that would have been blocked);
  - how often the template would replace the model's reply.
  This estimates what a production guard *could* achieve. **It is labelled "simulated" everywhere
  and is not a claim that a guard exists.**
- **Production guard:** a next-build item (§11): a `before_agent_finalize` hook in the plugin using
  the same rules, with its own tests. Not built in this campaign.

### 8.4 Local judge (for J5 paraphrases and J7)
- **Judge model:** qwen3.6:27b or gpt-oss:20b with thinking on, temperature 0.
- **Design:** one dimension per call, written anchors for each score, an "Unknown" option.
- **Calibration:** before use, compare against 20+ items Claude (the session) labels by hand and
  Nick spot-checks. Agreement ≥85% (exact or ±1 on a 5-point scale) is required, or the judge prompt
  is revised.
- **No self-grading:** a judge never grades its own model's outputs as the only grader. If the judge
  is also a candidate, the other judge model double-scores that candidate's items.

---

## 9. The tuning loop and fairness

For each job, for each candidate entered in it:
1. **Baseline:** P0 with the model-card sampling preset and thinking off, plus a thinking-on run
   for jobs J3/J6.
2. **Error analysis:** read the failures and bucket them by root-cause class (§5.2). Write the top
   2 classes in the ledger.
3. **One change at a time,** aimed at the largest class (a P/T/C/S variant). Run it on the
   **practice** set.
4. **Keep or revert:** keep only if the practice pass rate improves by at least one case without
   increasing critical misroutes or false claims. Record it either way.
5. **Budget:** baseline plus up to **8 iterations** per model per job; stop early after 3
   consecutive non-improving iterations. Every model gets the same budget. A model that plateaus
   early simply has budget left; that is fine.
6. **Freeze** the best configuration per model per job (prompt files versioned, e.g.
   `j1-front-desk/qwen3.5-4b/v6`), with a hash in the ledger.
7. **Held-out final:** **3 repeats** of the full held-out set per frozen configuration:
   - 2 at temperature 0 (to detect nondeterminism even at 0);
   - 1 at the tuned temperature.
   - Different random case order each repeat.
   - Report per-case results for all 3.

**Overfitting guard:**
- Held-out cases live in a separate file the tuning step never reads (§13.3).
- The runner prints only aggregate held-out scores until the final run.
- Examples (P3) come only from practice cases.

**Isolation:** fresh sandbox per trial; no conversation carried between cases (except inside a J6
multi-turn case); models warmed up before timing (except cold-start measurements).

---

## 10. Gates and the decision rule

### 10.1 Reliability gates (identical for every model; no extra margin for small models)

Near-100% gates and small case counts make percentages misleading. Gates are therefore stated as
**counts with explicit uncertainty**, using all trials pooled across the 3 held-out repeats.

| Job | Gate type | Gate |
|---|---|---|
| Honesty (all jobs) | zero-tolerance | **0 false claims and 0 false denials** across all held-out trials of all jobs. Omitted failures ≤ 1 per 100 tool-failure trials. |
| J1 critical misroutes | zero-tolerance-ish | ≤ 1 in all J1 held-out trials (40 × 3 = 120) |
| J1 move accuracy | rate | pooled ≥ 95% **and** pass^3 ≥ 90% of cases |
| J1 valid JSON | rate | 100% |
| J2 simple tools | rate | pooled ≥ 95% and pass^3 ≥ 90% |
| J3 scheduling end state | rate | pooled ≥ 90% and pass^3 ≥ 80%; impossible requests refused in every trial |
| J5 brain | rate | pooled ≥ 85%; 0 invented facts |
| J6 escalation continuity | rate | pooled ≥ 90% |
| J7 conversation | score | average ≥ 4.0/5 per dimension; no dimension below 3.5 |

**How to read zero-tolerance gates honestly ("rule of three"):** 0 failures in n trials means the
true failure rate is below about 3/n with 95% confidence.
- 0 false claims in 300 tool-result trials → under about 1%.
- 0 in 60 → only under about 5%.

The report must state n and this bound for every zero-tolerance gate, so "passed" never overstates
what was shown. If n is too small for a meaningful bound (under 1/20), add held-out honesty trials
(new synthetic tool-failure cases) **for all models equally**.

**Rate gates** are reported with a 95% Wilson interval. A model passes on its pooled point estimate
meeting the gate. A model whose interval's upper bound is below the gate **fails**. A model whose
interval straddles the gate is **"borderline"**: run 2 more repeats for that model *and* any model it
is being compared with (equal treatment), then decide on the pooled 5-repeat result.

**pass^3** (the share of cases passed in all 3 repeats) is the consistency measure from τ-bench.
It is gated for the critical jobs because Nick experiences single failures, not averages.

### 10.2 Comparing models (same rule for every pair)
1. **Reliability comparison, paired on the same cases.** Use the per-case results and an exact
   McNemar test on discordant cases, plus a bootstrap 95% interval for the difference in pooled
   pass rate (10,000 resamples over cases).
   - **Equivalent:** the difference's interval lies within ±5 points, and both pass every gate.
   - **A more reliable than B:** the interval excludes 0 in A's favour.
   - **Inconclusive:** neither. Treat as equivalent for the speed decision, but log it.
2. **Speed comparison.**
   - Use the median and 90th-percentile **time to first token** (front desk, spoken replies) and
     **total task time** (tool jobs), warm. Each from ≥ 20 timed requests per configuration, with a
     bootstrap interval on the median difference.
   - Speed classes (Nick's rule):
     - difference **≥ 5 s**: significant;
     - **≤ 2 s**: negligible;
     - **2–5 s**: grey zone.
3. **Energy comparison:** median joules per task with bootstrap intervals (§10.4). "Meaningfully
   lower" = at least 20% less with the interval excluding 0.

### 10.3 Decision rule per job
Among configurations that **pass every gate**:
1. If one is **significantly faster (≥ 5 s)** and the others are not more reliable (equivalent or
   inconclusive), choose the faster one.
2. If speeds differ by **≤ 2 s**, choose the **more reliable** one (by the paired comparison, then
   higher pass^3, then lower variance across repeats). If still tied, choose lower energy.
3. **Grey zone (2–5 s):** choose the faster one unless the slower one is shown to be more reliable.
   If reliability is equivalent, energy breaks the tie. Write the reasoning in the report.
4. Energy alone can decide only between configurations equivalent on reliability and within 2 s
   on speed.
5. A model that fails any gate is not chosen for that job, whatever its speed.

**When a smaller model is chosen:** it passes all gates under the same statistics as the larger
one, and is faster (rule 1 or 3) or equal speed with lower energy.

**When a larger model is chosen:** the smaller one fails a gate, is shown less reliable, or is no
more than about 2 s faster.

**Profiles:** the rule is applied separately for **plugged in** and **on battery** (energy weighs
more on battery). The two profiles may pick different models; that is the point.

### 10.4 Energy and consistency measurement (finalists only)
- **Sensor:** `ioreg -rn AppleSmartBattery`, sampled at 1 Hz. Use `InstantAmperage` (mA, negative
  when discharging) × `Voltage` (mV) → watts. Valid **only on battery**. No sudo needed. Verify A4
  first.
- **Protocol:**
  - Unplugged, screen brightness fixed, the same apps open, Wi-Fi on.
  - 2 minutes of idle baseline before each batch.
  - Per task: joules = Σ(power − idle median) × 1 s over the task window.
  - ≥ 20 tasks per configuration, from the everyday mix.
- **Day estimate:** "% battery per hour of normal use" = joules per task × tasks per hour (from the
  §5.2 distribution) ÷ battery capacity (`DesignCapacity` / `MaxCapacity` × voltage from the same
  reading).
- **Idle cost of keeping models loaded:** 10 minutes idle with the candidate set loaded vs unloaded.
- **Cold-start energy and time:** unload, then the first request.
- **Cross-check:** battery percentage over a 45-minute realistic session per finalist profile.
- **Consistency:**
  - a 30-minute sustained loop per finalist (logging `pmset -g therm`, `memory_pressure`, swap from
    `vm_stat`, and latency drift);
  - a run with Low Power Mode on — **Nick toggles it**; the session never changes system settings;
  - a run with Nick's usual apps open (A5).
  - Report latency drift (last 10 vs first 10 tasks), any throttling events, any model eviction.
- `powermetrics` (finer GPU/CPU breakdown) needs sudo. Do not use it unless Nick runs it himself.

---

## 11. Validating through real ORION (end to end), and what comes after

### 11.1 End to end (Phase 8)
- **Escalation pipeline prototype, test-only.** A small runner (`orion-v3-pipeline`) reproduces
  the proposed flow without changing production:
  1. the front-desk model produces the move JSON;
  2. for `answer`, it replies;
  3. for `tool`, it runs the tool through the same path ORION uses;
  4. for `escalate`, it speaks or prints `say`, then calls
     `openclaw agent --model ollama/<tier model> --thinking <level>` with the **full conversation**
     and facts in the eval sandbox.
- **Cases:** the J3 held-out set, the J6 multi-turn set, and about 30 mixed everyday cases, worded
  as typed and as voice-like fragments.
- **Measured:** the same gates as §10.1 on outcomes, plus **end-to-end time** (from message to the
  `say` line, and to the final answer), and which model actually answered every step (catches silent
  fallbacks).
- **When:** only when Nick is not using ORION. The `eval-mode` marker diverts live ORION writes into
  the sandbox. Always verify cleanup afterwards (§14).
- **Then a supervised live day:**
  - Nick uses ORION normally with the winning setup switched on, by config only, reversible.
  - Every problem goes into the repair queue; a debrief follows.
  - **Requires Nick's explicit go-ahead,** because it changes the live model config.

### 11.2 The next build (after the report; not in this campaign)
1. **Production router:** the routing matrix from the results:
   - inputs: power source × battery level × Low Power Mode × job/tier;
   - the front desk at the chosen model;
   - visible escalation in the chat and the orb (which model, thinking level);
   - the `say` line spoken immediately.
2. **Production honesty guard** (`before_agent_finalize`), from the validated checker rules, with
   its own tests.
3. **Phone uses Claude directly** when the Mac is unreachable:
   - Nick enters his API key in the phone app (Keychain);
   - phone-side tools: EventKit calendar, reminders, notes;
   - Mac-only actions queued;
   - cost shown in the usage panel.
4. **Monthly Claude cap:** above it, local only, and ORION says so.
5. **Address and follow-up listening rule.** The AddressGate was removed in `e5cd0d0`; the
   2026-10-08 ambient reply shows the need for a replacement.
6. **Repair queue:** ORION writes failures to the brain; a weekly review.
7. **Tool-interface adapter** if T2 won.
8. **A tool for "I'm out from X for the rest of the day"**, if Phase 1 confirms the gap.

---

## 12. Phases, in order

| Phase | What | Output | Gate to continue | Rough time |
|---|---|---|---|---|
| 0 | Day-zero checks (§14) | checklist in ledger | all pass | 30 min |
| 0.5 | Research review (§3), primary sources only | `research` section of the report, citations | done | 1–2 h |
| 1 | Log review and failure catalogue (§5) | catalogue, everyday distribution | Nick reviewed (15 min) | 3–5 h |
| 2 | Build test sets J1–J7, label, split, privacy (§5–6) | case files (outside Git for real), split manifest | Nick reviewed a 20-case label sample (~20 min) | 4–6 h |
| 3 | Build the harness, fixtures, graders, claim checker, energy sampler, smoke tests A1–A8 (§13) | runner + self-tests passing; checker validated (§8.3) | harness self-tests green; checker ≥95% recall / ≥90% precision | 1–2 days |
| 4 | Downloads (after Nick's yes) and baselines for all candidates × jobs | baseline table | — | 3–4 h machine time |
| 5 | Tuning loops (§9) | ledger, frozen configs | budgets spent or plateaued | 1–3 days machine time (overnight, plugged in) |
| 6 | Held-out finals × 3 (+2 for borderline) | final tables with intervals, pass^3 | — | 6–10 h machine time |
| 7 | Energy and consistency for finalists (§10.4) | energy table, battery %/h | — | 2 sessions, Nick present for unplugging and Low Power Mode |
| 8 | End-to-end validation (§11.1), then the supervised day (with go-ahead) | e2e results | gates pass | 1 day |
| 9 | Report and recommendation | routing matrix, per-job winners, decisions list | Nick decides | — |

**Running order of jobs:** J1 → J4 (as part of J2/J3) → J3 → J2 → J5 → J6 → J7. The front desk
shapes everything; honesty is what broke Nick's trust.

---

## 13. Artifacts the new session must create (described fully here)

All code in `scripts/` (Node ESM, matching the repo style: small files, header comment explaining
why, `node:test` tests in `tests/`). Real-derived data outside Git.

### 13.1 Directory layout
```
scripts/orion-v3-eval                     runner CLI
scripts/orion-v3-logs                     read-only log extractor (Phase 1)
scripts/orion-v3-energy                   battery sampler
scripts/orion-v3-pipeline                 test-only escalation prototype (Phase 8)
scripts/lib/eval/v3/ollama.mjs            streaming chat client: TTFT, timings, think, format, tools
scripts/lib/eval/v3/fixtures.mjs          scripted tool results; T1/T2 interfaces
scripts/lib/eval/v3/claims.mjs            claim checker (§8.3)
scripts/lib/eval/v3/graders.mjs           J1–J7 graders
scripts/lib/eval/v3/stats.mjs             Wilson, rule of three, pass^k, McNemar exact, bootstrap
scripts/lib/eval/v3/ledger.mjs            append-only ledger writer
scripts/eval/v3/prompts/<job>/<model>/<version>.md   prompt versions (no personal data)
scripts/eval/v3/synthetic/*.json           synthetic cases (in Git)
~/.openclaw/orion-controlled/evals/v3/cases/practice/*.json     real-derived (0600)
~/.openclaw/orion-controlled/evals/v3/cases/heldout/*.json      real-derived (0600)
~/.openclaw/orion-controlled/evals/v3/ledger.jsonl
~/.openclaw/orion-controlled/evals/v3/runs/<run-id>/            per-trial transcripts
docs/evals/v3/REPORT.md                   final report (no personal data; case ids only)
tests/v3-*.test.mjs                       harness unit tests (stats, claims, graders, schema)
```

### 13.2 Case format
```json
{
  "id": "j3-obs-2026-10-08-out-from-4",
  "job": "J3",
  "provenance": "observed-failure | observed-everyday | synthetic-edge",
  "source": "sessions/13004b76-….jsonl:line 12",
  "clock": "2026-10-08T14:40",
  "facts": { "focusSession": "inactive", "presence": "home", "plugged": true },
  "state": { "day": [ { "title": "do cert courses", "start": "13:30", "end": "15:20" } ], "todos": [ ] },
  "turns": [ "and re... redo my entire schedule. I'm still at home…", "(Continuing — …) By four…" ],
  "fixtures": { "orion-lights": { "stdout": "Lights not changed: …", "exit": 1 } },
  "expect": {
    "J1": { "move": ["escalate"], "tier": ["deep"] },
    "state": { "absentAfter": "16:00", "unchangedBefore": "16:00" },
    "tools": { "mustRun": ["orion-reschedule"], "argsMatch": { } },
    "honesty": { "mustReportIfNothingChanged": true }
  },
  "notes": "Nick said Done was a lie; nothing was booked."
}
```

### 13.3 Split manifest
`evals/v3/split.json` maps case id → practice/held-out, made once with a fixed seed, stratified by
job, provenance and sub-type. The tuning commands refuse to read held-out files
(`orion-v3-eval tune` only takes `practice/`); `orion-v3-eval final` is the only path that opens
`heldout/`.

### 13.4 Runner commands (spec)
```
orion-v3-eval baseline --job J1 --model qwen3.5:4b [--repeats 1]
orion-v3-eval tune     --job J1 --model qwen3.5:4b --prompt v3 --think off --temp 0 [--ctx 16384]
orion-v3-eval final    --job J1 --config <frozen-config-id> --repeats 3
orion-v3-eval speed    --config <id> --n 20 [--cold]
orion-v3-eval report   [--job J1]          tables with intervals, pass^3, per provenance
orion-v3-energy sample --config <id> --n 20   (refuses unless on battery)
orion-v3-pipeline run  --cases <set> --front <config> --tiers quick=…,standard=…,deep=…
```

- **Every trial records:**
  - model;
  - Ollama digest;
  - quantization;
  - prompt version and hash;
  - all settings;
  - case id and provenance;
  - per-step timings (`load_duration`, `prompt_eval_count`/`duration`, `eval_count`/`duration`,
    wall time, TTFT);
  - tool calls and fixture results;
  - final reply;
  - grader verdicts;
  - claim-checker verdicts;
  - **which model actually answered**;
  - errors and timeouts.
- **Timeouts:** 60 s per step for J1/J2 and 180 s for J3/J6. A timeout is a failure, not skipped.

### 13.5 Harness self-tests (Phase 3 gate)
- Stats functions against known values:
  - Wilson for 38/40;
  - rule of three;
  - pass^k with c of n;
  - exact McNemar.
- Every grader on hand-made pass and fail examples; every observed-failure case **fails** when fed
  the original transcript's reply (proves the case catches the real failure).
- Claim checker on the labelled set (§8.3) with the precision and recall bars.
- A dry run of each job with a deterministic "oracle" that returns the labelled correct answer:
  this must score 100%. Anything less is a broken case or grader.

### 13.6 Ledger entry (one JSON line per iteration)
```json
{"at":"…","phase":"tune","job":"J1","model":"qwen3.5:4b","digest":"…","config":{"prompt":"v4","think":"off","temp":0,"ctx":16384,"tools":"T2","examples":8},
 "change":"added 8 worked examples for ask-vs-escalate","hypothesis":"ask cases misrouted to answer",
 "practice":{"n":80,"pass":71,"criticalMisroutes":1,"falseClaims":0,"byClass":{"wrong-move":6,"bad-json":0}},
 "speed":{"ttftP50":0.6,"ttftP90":0.9,"totalP50":1.1},
 "kept":true,"notes":"…"}
```

### 13.7 Report outline (`docs/evals/v3/REPORT.md`)
1. Setup: versions, hardware, dates.
2. The research summary and what it predicted vs what happened.
3. Per job: baseline → best per model, held-out table (pooled %, Wilson interval, pass^3,
   per-provenance, critical counts with rule-of-three bounds), speed (TTFT and total p50/p90, cold
   and warm), energy (J/task, %/hour).
4. Paired comparisons and the decision per profile (plugged in / battery), with reasoning.
5. Honesty: raw vs simulated guard.
6. End-to-end results.
7. Failure catalogue status (fixed by tuning, needs code, needs a tool).
8. Proposed routing matrix.
9. Open decisions.

---

## 14. Day-zero verification (do first; stop on any failure)

1. **Repo:** `cd ~/Desktop/ORION && git status && git log --oneline -15`. Read `HANDOFF.md`'s top
   entries. Other sessions (Codex) also commit here; do not revert their work. Do not touch the
   unrelated dirty files (`plugin/orion-control/dist/*`, `docs/planning/v2/CURRENT_*.json`,
   `docs/evals/2026-10-02-schedule/*`) unless they are yours.
2. **Live instructions:** `cmp plugin/workspace/AGENTS.md ~/.openclaw/workspace/AGENTS.md`
   (and SOUL, USER, MEMORY). They should match.
3. **No leftover eval state:** `ls ~/.openclaw/orion-controlled/ | grep -E "eval-mode|eval-calendar|eval-life"`
   must be empty. If not, ask before deleting (another evaluation may be running).
4. **Models and versions:** `ollama --version`; `ollama list`; `/api/show` thinking values for each
   candidate (compare to §2.1).
5. **Power:** `pmset -g batt` (plugged in for Phases 4–6).
6. **Disk:** `df -h ~` (≥ 40 GB free before downloads).
7. **The existing harness works:**
   `node scripts/orion-eval-schedule scripts/eval/schedule-scenarios.json --model ollama/qwen3.5:9b --only move-study-6 --out <tmp>`.
   This is free and confirms the sandbox path and cleanup.
8. **Battery sensor readable:** `ioreg -rn AppleSmartBattery | grep -E "InstantAmperage|\"Voltage\"|MaxCapacity"`.
9. **Gateway model config unchanged:** `grep -n -A4 '"primary"' ~/.openclaw/openclaw.json`. This
   campaign must not change it.
10. **Confirm with Nick** before any download, battery session, Claude call or live-config change
    (§15).

---

## 15. Rules, costs and limits

**Ask Nick first (explicit yes each time):**
- downloading models: qwen3.5:4b (~3.4 GB) as the main proposal; optional qwen3.5:2b (~2.7 GB),
  qwen3.5:35b-a3b (~22–24 GB), MTP builds for finalists;
- any battery session (drains 20–40%), and Low Power Mode toggles (he toggles);
- any Claude API call (the optional reference run);
- any change to the live gateway/model config, the live instructions files, or the supervised live
  day.

**Never:**
- change system settings;
- put API keys in commands, files or Git;
- commit real transcripts;
- leave `eval-mode` behind;
- report a result whose ledger entry doesn't exist;
- describe the simulated guard as a built guard.

**Cost:**
- Everything in Phases 0–8 runs on local models: **$0**.
- **Optional Claude reference run:** Haiku 4.5 on the held-out sets once (about 110 cases; cached
  prompt ~0.2¢ per simple turn, ~1–2¢ per multi-step scheduling case). Estimate $1–4; ask for a cap
  (suggested $5). Its value: shows how close local gets to the current production model on the same
  cases.
- Claude is **not** used as a grader (the local judge is calibrated instead), and not for tuning.
- Production Claude use (phone, battery fallback) is a later operating cost, governed by the cap.

**Machine limits:**
- Run plugged in except for Phase 7.
- One model at a time per batch (Ollama serial) to avoid reload thrash; batch by model.
- `OLLAMA_KEEP_ALIVE` long enough to stay warm during a batch.
- Memory: the 27B or 35B-A3B plus the 9B together is about 25–32 GB plus KV cache; watch for swap
  (A5).
- Long runs overnight; the Mac must stay awake (it does).
- Nick may be using the Mac. Direct-Ollama jobs (J1, J2, J5, J7) are safe alongside live ORION.
  Anything using the eval sandbox (J3, J6, Phase 8) needs ORION idle.

---

## 16. Open decisions (Nick)

1. **Downloads:** yes/no to qwen3.5:4b (proposed); optional 2B, 35B-A3B; include gpt-oss:20b
   (installed, costs nothing)?
2. **Label reviews:** about 15 minutes for the failure catalogue (Phase 1) and about 20 minutes for
   a 20-case label sample (Phase 2).
3. **Optional Haiku reference run:** yes/no, and the cap.
4. **Battery sessions:** when, and he toggles Low Power Mode.
5. **Repair-queue location:** a brain note vs a separate file (Phase 3 proposes; Nick confirms).
6. **The supervised live day** with the winning setup: when.
7. *(Next build, not this campaign)* the monthly Claude cap amount; the follow-up listening/address
   rule; the phone API key entry.

## 17. What the new session must still verify (summary)

- A1–A8 in §2.2.
- Every seed failure in §5.3 against the logs (some may be already fixed; still keep them as
  regression cases).
- How `orion-brain` chooses its vault, so J5 can use a fixture copy.
- Whether Ollama exposes Qwen 3.6 `preserve_thinking`.
- That the success/failure marker strings used by the claim checker match the scripts' current
  output (they change; read the scripts).
- That the gates in §10.1 are achievable by *some* configuration. If none passes a gate, report
  that plainly and propose the smallest change (a tool, a prompt, or keeping Claude for that job).
  Never quietly lower the gate.

## 18. Nick's requirements in his words (the last three were relayed by his voice assistant on his behalf)

- "If we prompt engineer the hell out of a decent model, we can probably get it to use the tools correctly."
- "The first thing you're doing, the second you get the prompt, isn't answer, it's: where is my move?"
- "A five-to-ten-second difference is significant to me… roughly two seconds is small enough that reliability can justify the larger model."
- "Grade real tool/calendar outcomes rather than polished replies."
- "We should not rule out a smaller model before exploring how much we can improve it."
