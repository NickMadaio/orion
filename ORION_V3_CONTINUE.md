# ORION V3 — continuation handoff (state at 2026-10-10 18:25 BST; base 2026-10-09 11:24)

Written by Claude (Opus 5.5) for whichever session picks this up next — possibly on a
different Claude account with no access to the conversation that produced it. Read this file
in full, then `ORION_V3_HANDOFF.md` (the plan: goals, gates, fairness, cautions). This file
says what has been DONE, what is RUNNING, what is LEFT, and the exact commands.

Nothing here touches the live ORION config. No Claude API calls have been made ($0 spent).

---

## Update 2026-10-10 18:25 BST (newest first) — campaign essentially complete

- All Phase 5 tuning and Phase 6 finals done for all five models (auto-freeze: `scripts/eval/v3/ops/auto-freeze.mjs`). Speed measured cold+warm on AC, thermal nominal. Phase 8 pipeline (4B front → 9B via the real route) ran: 7/21, ~35 s — the gateway uses production prompts, not the tuned ones. Eval marker verified removed.
- **`docs/evals/v3/REPORT.md` §9 = the recommendation** (routing matrix, per-job winners, decisions for Nick). Read it first.
- **Remaining:** (1) Phase 7 battery session — needs Nick to unplug: run `scripts/orion-v3-energy sample --model <m> --minutes 4` for qwen3.5:4b-q4_K_M, qwen3.5:9b, gpt-oss:20b (optionally llama, 27B), then add an energy table to REPORT §9 and set battery thresholds. (2) Nick's decisions in §9.4 (supervised live day, porting prompts, gateway registration, removing the 27B). Nothing else is queued.

## Update 2026-10-09 21:15 BST (newest first)

- **9B J5 (brain) frozen**: `p0 + T1 + honesty + rules + examples, temp 0` → **22/23 on the expanded practice set**, 0 false claims, ~2.4 s. 9B J6 (continuity) pcoach config holds at **15/19** on the expanded set.
- **9B J7 judged** (provisional gpt-oss v1): correctness 4.3, spoken 5.0, context 4.58, overAsk 4.3, tone 4.71 — second only to the 27B (4.5/4.92/4.92/4.65/4.75); well ahead of the 4B and llama.
- **Queue stalled 19:04–21:10**: the worker's `pgrep -f "scripts/orion-v3-eval"` matched a Claude waiter shell whose command line contained that text. Fixed in `scripts/orion-v3-queue` (`pgrep -f "^node scripts/orion-v3-eval"`); the CURRENT worker process still runs the old loop until restarted. **Rule: never put the string `scripts/orion-v3-eval` in a long-running waiter command** — wait on `queue/<n>.done` files only, and run any freeze/queue commands in a separate, short call.
- Next in the queue: 1044y7/y8 = 9B J5 and J6 finals on the NEW held-out sets; then 1044z1 = 4B J3 pcoach explore (then freeze its best and rename `223a-3.hold` → `.job`); then the 2xx block (J2 tunes for gpt-oss/27B; J5/J6 ladder tunes for llama/4B/gpt-oss/27B on the expanded sets).
- After those tunes: hand-explore each model's J5/J6 with the configs that won for the 9B (`examples+honesty+rules temp 0` for J5; `pcoach+examples` for J6), freeze, run finals. Then speed (cool Mac), Phase 7 battery (tell Nick), Phase 8 pipeline, Phase 9 recommendation.

## Update 2026-10-09 19:05 BST (newest first; then the 16:37 update below)

- **Claims checker fixed** (e74d09b): "moved from <old> to <new>" and a removed block named by its calendar time are not wrong details; dropped/extended/resized/shortened/renamed count as change claims. Real set still 65/65. J3 finals re-graded with `ops/regrade-final.mjs` (aggregates only): **gpt-oss 27/36 (0 FC, ~28 s), 27B 24/36 (3 FC), 9B 23/36 (0 FC, ~14 s, pcoach+examples+think on)**.
- **4B J1 p6+restate final 123/138** — identical to p4; practice gain (89→94/97) didn't transfer. Compact JSON (`compact: true`) saves ~0.4 s/msg on the 4B but cost 3 practice cases; rejected.
- **9B J5 final 7/18, J6 final 6/12 (3 FC)** on the OLD tiny held-out sets. **J5 +17 and J6 +16 synthetic cases added** (now J5 23/12, J6 19/9 practice/held-out; split stable). All J5/J6 finals must be re-run on the new sets. 9B J5/J6 re-explore on the bigger practice sets is running (1044x9/xa); next step: read its practice failures, write `prompts/j5/coach`-style guide if useful, freeze, re-run finals.
- **J6 coach** (`prompts/j6/coach.md`, base `pcoach`): 9B 6/8 practice (was 3/8). Frozen config `pcoach+honesty+rules+examples temp 0`.
- **Judge**: v2 rubric REJECTED (agreed less than v1 on identical items). v1 is the **provisional** J7 judge: 84% within ±1 over 240 hand-scored pairs (samples A and B in `review/`), bar 85%. gpt-oss judged llama/4B/27B; 9B queued (1044y5). gpt-oss's own J7 run has no judge (27B is too slow, 62.5%) — hand spot-check it.
- **Thermal**: every tune/explore/final/speed entry now records `thermal` (ProcessInfo.thermalState). Speed refuses to run when serious/critical. Nick's backpack hour (≈15:40–16:40 BST) is a ledger caveat.
- Holds: `queue/223a-3.hold` = 4B J3 final, waiting on the 4B pcoach explore (1044z1). Freeze the better config, then rename `.hold` → `.job`.
- Lesson (again): small practice sets overfit. Prefer adding cases over prompt-patching a model's last few practice misses.

## Update 2026-10-09 16:37 BST (read this first; sections below are the 11:24 state)

New held-out finals (ledger has each):
- J2 simple tools: **9B 33/33** (pass^3 1.0, 0 false claims, ~2.2 s median); 4B 24/33 (3 false claims, 5 omitted failures).
- J3 scheduling: gpt-oss (think high) 25/36, 0 false claims, 2 wrong details — but median 28 s, p90 198 s (unusable live). 27B was 26/36, ~12 s.
- J1 9B with 40 examples: 105/138 (worse than 25 examples' 111/138 → overfit). **Re-frozen back to 25 examples** (hash 3bbb9775bab0).
- Speed per held-out run is in each run's trials.jsonl (`timings.ttftMs`, `wallMs`). J1 medians: llama 0.8 s, gpt-oss 1.3, 9B 1.6, 4B 2.7, 27B 6.0.

J7 judge calibration (`node scripts/eval/v3/ops/judge-calibration.mjs <judge> [v1|v2]`):
- gpt-oss v1: 82.5% within ±1 (bar 85%) — too lenient (5s for replies with the right shape). **v2 rubric** (stricter anchors, `JUDGE_VERSION` in judge.mjs; output `judged-<judge>-v2.jsonl`) queued as 1044y1–y3. Then run calibration with `v2`. If ≥85%, judge all J7 runs with it. Caveat: v2 was written after seeing the 8-id sample's disagreements, so hand-score a fresh sample before fully trusting it.
- 27B as judge: 62.5% on 40 pairs and ~8 min per reply — dropped (1041 skipped).

9B priority (Nick: "incredible how well 9B is doing"): queue jobs 1044x1–x5 run before the 223a/2xx block:
- 1044x1 explore J3 9B with the new **pcoach** base (`prompts/j3/coach.md` appended to pfull: impossible-request check, extend vs resize, one command, check result, ≤4 calls, quote times only from output). The 9B J3 final is HELD as `queue/223a-4.hold` — freeze the best of pcoach vs pfull+think-on (11/25), then rename to `.job`.
- 1044x2/x4: J5 and J6 tunes for the 9B (moved from 235/245).

Queue worker: the old one died with the session at ~16:24. Restarted **detached** (`nohup scripts/orion-v3-queue work &`). If `queue/*.running` exists but no `orion-v3-queue` process runs, the worker died: mark that job done/requeue it, then restart.

---

## 0. Read order and first five minutes

1. This file. 2. `ORION_V3_HANDOFF.md` §1, §6, §8–§12, §15 (plan). 3. `AGENTS.md` (repo rules:
   commit + push finished work, no history rewrites, dated HANDOFF.md entries, run `date`
   before writing dates). 4. `docs/evals/v3/REPORT.md` (results so far, no personal data).
5. The ledger, newest lines first: `tail -40 ~/.openclaw/orion-controlled/evals/v3/ledger.jsonl`.

First commands:
```bash
cd ~/Desktop/ORION && git pull && git log --oneline -8
scripts/orion-v3-queue status            # is the work queue running? what is next?
pmset -g batt | head -1                  # must be on AC for runs (queue pauses on battery)
pgrep -fl "orion-v3-queue work" || echo "worker not running"
node --test tests/v3-*.test.mjs 2>&1 | grep -E "^ℹ (tests|pass|fail)"   # expect all pass (~150)
```
If the worker is not running: `scripts/orion-v3-queue work` (run it in the background; it
waits for any running `orion-v3-eval` before starting the next job, and stops when the queue
is empty AND `~/.openclaw/orion-controlled/evals/v3/queue/STOP` exists).

---

## 1. Nick's decisions and how he wants this run (all recorded in the ledger)

- **Approved:** download `qwen3.5:4b-q4_K_M` (done). **No** Haiku reference run for now.
- **Battery sessions:** any time — **tell him first**; he unplugs and toggles Low Power Mode.
- **Repair queue:** yes — failures/ideas to save go to the brain note **"ORION repair queue"**
  via `orion-brain learn "ORION repair queue" "failure" "<what, when, what he asked>"`. He notes
  ORION should already do this (the 2026-10-06 logs show it said "noted" without calling it).
  He wants a later **review of ORION's full capabilities** with him.
- **Tuning direction (2026-10-08):** fairness rule relaxed. Each model gets its OWN best shot —
  model-specific prompts, as big as help. Track per model what it gets right/wrong by category.
  Goal: settle on at least **one small and one big** model (ideally small/medium/big) per job,
  then continue the plan. The fixed ladders are only a first pass; hand-engineer after.
- **Autonomy:** run without check-ins; ask only for real blockers (money, downloads, live
  config changes, things only he can physically do). Report at milestones, plain language.
- **Still needs his explicit go-ahead:** any live gateway/model/instruction change; the
  supervised live day (Phase 8b); new downloads (2B, 35B-A3B, MTP builds).
- His Claude weekly limit was ~88% on 2026-10-09 — keep sessions efficient.

---

## 2. Results so far (practice = tuned-on; held-out = unseen, 3 repeats, the honest number)

### J1 front desk (decide answer/tool/escalate/ask/ignore) — gate ≥95%, pass^3 ≥90%, ≤1 critical
| Model | Frozen setup | Practice | Held-out | pass^3 | Critical |
|---|---|---|---|---|---|
| **qwen3.5:4b-q4_K_M** | p4, all fields, temp 0 | 89–90/97 | **123/138 (89.1%)** | 0.89 | 6 |
| gpt-oss:20b | p4, 25 examples, temp 0 | 80/97 | 113/138 (81.9%) | 0.80 | 4 |
| qwen3.5:9b | p4, 25 examples, temp 0 (40 ex gave 88/97, not frozen) | 86/97 | 111/138 (80.4%) | 0.80 | 6 |
| qwen3.6:27b | p4, 25 examples, temp 0 | 86/97 | 111/138 (80.4%) | 0.80 | 12 |
| llama3.2:3b | p5, 75 examples, temp 0 | 80/97 (inflated) | 93/138 (67.4%) | 0.67 | 6 |
No model passes J1 yet. 4B is the small-model front desk. Thinking ON made the 4B time out
(60 s) on 86% of messages — front desk stays think-off. llama is not a front-desk candidate.

### J4 honesty (tool failed/did nothing/pending → reply must say so) — gate 0 false claims
| Model | Frozen setup | Practice (regraded) | Held-out | False claims |
|---|---|---|---|---|
| **qwen3.5:9b** | T2 (one function per tool) + honesty + rules + selfcheck, temp 0 | 16/16 | **24/24** | **0** |
| **gpt-oss:20b** | honesty + rules + selfcheck, temp 0 | 15/16 | **23/24** | **0** |
| qwen3.6:27b | honesty + rules + selfcheck, temp 0 | 15/16 | 18/24 | 3 |
| qwen3.5:4b | honesty + rules | 15/16 | 16/24 | 2 |

### J3 scheduling (real orion-reschedule on a private sandbox day) — gate ≥90%, pass^3 ≥80%
| Model | Frozen setup | Practice (regraded) | Held-out | Time/task |
|---|---|---|---|---|
| **qwen3.6:27b** | pfull + honesty + rules (think off) | 17/25 | **26/36 (72%)**, pass^3 0.67, 3 FC | ~13 s |
| gpt-oss:20b | pfull + honesty + rules, think high | 15/25 | final running at handoff | ~34 s (12/25 at ~3 s think-off) |
| qwen3.5:4b | pfull + honesty + rules, think on | 13/25 | queued | ~16 s (11/25 think-off ~3 s) |
| qwen3.5:9b | pfull + honesty + rules, think on | 11/25 | queued | ~18 s |
| llama3.2:3b | — | 2–3/25 | — | — |
Scheduling is the hardest job; nobody is near 90%. Biggest remaining failure: **time
arithmetic** ("push study back 30 min" computed from now instead of study's start).

### J2 simple tools (lights, alarm with label, focus session, phone unlock, log, show, …)
Ladder only so far: **qwen3.5:9b with T2 + rules: 23/23 practice, 0 honesty problems**
(frozen); qwen3.5:4b 15/23 (frozen, p0). gpt-oss and 27B J2 tuning queued; finals for 9B/4B
queued.

### J5 brain, J6 continuity, J7 conversation
Baselines only (J5: 27B 10/12, 9B/gpt-oss 6/12; J6: 0–3/8). J5/J6 ladders queued. J7 replies
generated for all 5 models (runs `*-J7-*-baseline`), **judge not yet calibrated** (see §5.4).

### Per-category right/wrong
`node scripts/orion-v3-eval breakdown --job J1` (or J2…) writes
`~/.openclaw/orion-controlled/evals/v3/review/breakdown-<job>-<label>.md`. Common pattern on
J1: all models under-escalate multi-part day changes and miss "ignore" (fragments, TV,
speech to others); the 4B over-asks; llama leaves answers empty; 9B/27B use one tool where
the job needs escalation.

---

## 3. Findings worth acting on in the NEXT BUILD (production ORION)

1. **TOOLS.md / orion-help hide tool semantics.** The one-line `orion-help orion-reschedule`
   (what ORION sees) drops the script header's worked mappings; models misread `extend` (it
   ADDS minutes). Giving the full header (`scripts/eval/v3/prompts/j3/pfull.md`) took the
   27B from 6→16/25 on scheduling. Put full usage (or the header) in ORION's tool docs.
2. **`alarm_set(at)` is documented without `label`** in live TOOLS.md, while AGENTS.md says
   always pass it → likely cause of the 2026-10-07 silent reminder (catalogue F08).
3. **Relative moves:** add `orion-reschedule move "<title>" --by +30` (models keep getting the
   arithmetic wrong).
4. **Honesty guard:** even good models occasionally claim success; build the `before_agent_
   finalize` guard from `scripts/lib/eval/v3/claims.mjs` (validated: 100%/100% on 65 real
   labelled replies; synthetic gate ≥95% recall). Report the simulated-guard numbers (§8.3).
5. **The 10-06 "noted / I'll add it" failures:** ORION never called the save command. The
   repair-queue rule above + honesty block fixes this in prompts; the guard catches the rest.
6. Silent llama fallback looped on the repeat guard and spoke raw tool JSON (catalogue F09).

---

## 4. What exists (all committed and pushed to `main`)

**Commands** (all `scripts/`):
- `orion-v3-logs` — Phase 1 extractor (real turns → `evals/v3/logs/turns.jsonl`, flags).
- `orion-v3-eval build` — assemble cases (real private + synthetic repo), validate, stable
  seeded split → `evals/v3/cases/{practice,heldout}/<job>.json`, `split.json`.
- `orion-v3-eval run --job J --model M [--prompt p0] [--think off] [--temp card|0] [--iface T1|T2] [--label baseline] [--oracle] [--schema-all] [--history N]` — practice only.
- `orion-v3-eval tune --job J --model M` — fixed ladder first pass; freezes best to `evals/v3/configs/<job>/<model>.json`.
- `orion-v3-eval explore --job J --model M --configs '[{…},…]'` — hand engineering; every try a ledger line.
- `orion-v3-eval freeze --job J --model M --config '{…}' --why "…"` — lock a hand-chosen config.
- `orion-v3-eval final --frozen --job J --model M [--repeats 3]` — held-out, aggregates only.
- `orion-v3-eval breakdown --job J [--label baseline]`, `speed --model M [--n 20] [--cold]` (AC only), `report` (writes REPORT.md §3/§8 from ledger), `judge --run <runId> --judge <model>` (J7).
- `orion-v3-energy check | sample --model M [--minutes 4]` (battery only).
- `orion-v3-pipeline run --tiers quick=ollama/…,standard=ollama/…,deep=ollama/… [--front M]` (Phase 8; needs ORION idle 15 min; uses the global eval marker; cleans up).
- `orion-v3-queue work | add "<args>" | status` — the work queue.
- Re-grade stored runs after a grader fix (no re-running): `node scripts/eval/v3/ops/regrade.mjs` (J1),
  `regrade-tools.mjs J4` (J2/J4/J5), `regrade-j3.mjs J3` (J3/J6), `claims_real.mjs` (claim-checker validation on the private labelled set).

**Config shapes.** J1: `{style: p0|p2|p3|p4|p5, schemaAll, examples: N, xml, restate, temp, historyTurns}`
(templates `scripts/eval/v3/prompts/j1/`). Tool/schedule jobs: `{base: p0|p0t2|pfull, iface: T1|T2,
rules, honesty, procedure, selfcheck, examples, restate, think: off|on|high, temp, ctx}` (blocks in
`scripts/eval/v3/prompts/blocks.json`, bases per job in `prompts/<job>/`).

**Libraries** `scripts/lib/eval/v3/`: ollama (streaming, TTFT), loop (agent), sandbox (private
day for real calendar scripts via env overrides — live ORION never diverted; preflight aborts
if not isolated), fixtures (T1/T2, scripted outputs), claims (honesty checker), graders,
cases (split), presets (card sampling; think mapping: Qwen on/off only, gpt-oss low/medium/high,
llama none), prompts, tune, final, report (decision rule §10), report-md, breakdown, judge,
run-j1/run-tools/run-schedule/run-j7, battery, pipeline, logs/jobs/exclude/turns, ledger, stats.

**Data (private, outside Git, 0600):** `~/.openclaw/orion-controlled/evals/v3/`
`ledger.jsonl` (source of truth), `cases/` (real-derived cases + labels), `configs/`, `runs/<id>/`
(trials.jsonl with replies, calls and tool outputs; prompt.json), `logs/`, `catalogue.json`
(26 real failures), `claims/` (labelled set), `review/`, `queue/`.

---

## 5. What is LEFT, in order (exact next steps)

### 5.1 Let the queue finish (no action; check `scripts/orion-v3-queue status`)
Pending at handoff: J3 finals (gpt-oss running, 4B, 9B), J2 tune gpt-oss + 27B, J5 tune ×5,
J6 tune ×5, J2 finals 9B + 4B. Several hours of machine time.

### 5.2 Hand-engineer J2, J5, J6 per model (Nick's direction), then freeze + final
Pattern that worked on J4/J3: start from the best ladder config, add `honesty`+`rules`, try
`selfcheck`, `temp 0`, `examples`, `iface T2` (J2/J5), `think` (J6), e.g.:
```bash
scripts/orion-v3-queue add "explore --job J2 --model gpt-oss:20b --configs '[{\"base\":\"p0t2\",\"iface\":\"T2\",\"honesty\":true,\"rules\":true,\"selfcheck\":true,\"temp\":0}]'"
```
Read failure transcripts (`runs/<id>/<hash>/trials.jsonl`) BEFORE trusting scores — six grader
bugs were found this way (§6). Then `freeze` the best per model and queue `final --frozen`.
J6 uses `pfull` too (schedule job). J5 real cases use read-only brain fixtures.

### 5.3 Re-try J1 for the 9B with 40 examples (88/97 practice) and freeze/final if better.
Consider a J1 p6 for the 4B targeting its remaining practice misses (past times "at 9" when
it is 10:20 → 21:00; "add X to my to-dos" → tasks tool; stray continuations → ignore).
Do NOT look at held-out failure details (overfitting rule) — aggregates only.

### 5.4 J7 judge calibration (needs a Claude session's hand scores)
1. Pick 24 replies across 2–3 models from `runs/*-J7-*-baseline/trials.jsonl`.
2. Hand-score each on the 5 dimensions in `scripts/lib/eval/v3/judge.mjs` (1–5, anchors there).
3. Run `orion-v3-eval judge --run <runId> --judge gpt-oss:20b` and `--judge qwen3.6:27b` on those runs; compute agreement with `agreement()` (±1 within ≥85%). Revise the judge prompt if lower.
4. A judge never grades its own model alone (the command refuses self-grading).
5. Then judge all 5 models' J7 runs; gate: average ≥4.0, no dimension <3.5.

### 5.5 Speed on AC (Phase 6, after freezes): `orion-v3-eval speed --model M --n 20` and `--cold`
for each finalist (front desk TTFT). Tool/schedule task times come from the finals' timings.
The 9B and gpt-oss J1 *baseline* timings on 2026-10-08 ran on battery — do not use them.

### 5.6 Report: `orion-v3-eval report` → REPORT.md §3 (per job: pooled, Wilson, pass^3, honesty with rule-of-three bounds, gates, speed) and §8 (routing). Read and edit the prose; no personal data.

### 5.7 Phase 7 battery session — WITH NICK (tell him; ~1–1.5 h unplugged, he's at the Mac)
`orion-v3-energy check` then `orion-v3-energy sample --model <M> --minutes 4` per finalist
(front desk). Method changed from the plan (§6): the gauge publishes once a minute, energy is
measured over idle/busy windows from PowerTelemetryData accumulators. Also: 10 min idle with
models loaded vs unloaded; one run with Low Power Mode on (he toggles it).

### 5.8 Phase 8 end-to-end (when ORION has been idle ≥15 min, e.g. overnight)
`orion-v3-pipeline run --jobs J3,J6 --front qwen3.5:4b-q4_K_M --tiers quick=ollama/qwen3.5:9b,standard=ollama/qwen3.5:9b,deep=ollama/qwen3.6:27b`
(pick tiers from the results). It uses the real route and the global eval marker; verify
`ls ~/.openclaw/orion-controlled | grep eval-` is empty afterwards. The **supervised live day
needs Nick's explicit go-ahead** (it changes live model config).

### 5.9 Phase 9 — recommendation to Nick: routing matrix (plugged-in vs battery), per-job winners
with honest numbers, the next-build list (§3), and what to keep on Claude (if any job fails all gates).

---

## 6. Corrections and lessons (do not re-learn these)

- **A1:** Ollama treats Qwen `think:"low|medium|high"` exactly like `true` — Qwen thinking is on/off.
  gpt-oss only accepts low/medium/high (an "on" sent 0/25 until fixed).
- **A4 / energy:** the battery registry publishes ~once a minute; use window averages from
  `PowerTelemetryData` accumulators (verified: idle 1.26 W, llama load 13.4 W). `MaxCapacity` is
  a percent; use `AppleRawMaxCapacity` (mAh).
- **Live TOOLS.md** is regenerated by the runtime (90 commands); the repo copy is stale. Use live.
- **Grader bugs found by reading transcripts** (all fixed with tests): case-sensitive/too-loose
  args regexes (a key name "until" passed); "Logged…/Showing…" not success markers; curly
  apostrophes; partial light changes; modal/infinitive phrasing ("needs to be sent"); "It was
  booked" read as narration; "couldn't" not accepted as saying no; `orion_task_run` steps as a
  non-array crashed runs. **A 0% or a whole-model pattern usually means a grader bug — read first.**
- **Label revisions** (all models equally, logged in the ledger): J1 tiers accept the adjacent
  tier; numeric args use word boundaries; one ambiguous case (j1-real-059) widened.
- **Never run two model jobs at once** — a parallel 4B thinking run starved the queue. Use the queue.
- **Power:** the queue pauses on battery (Nick unplugged at 19:22 on 10-08); runs record power.
- **Overfitting:** never inspect held-out failure details; tune on practice only. llama's
  75-example prompt scored 80/97 practice but 67% held-out.
- **The automatic keep/revert rule** rejected big gains over a +1 critical/omission; under
  Nick's direction choose per model by hand from the full results.
- **Sandbox safety:** env must be passed as an object (no shell); `createSandbox().preflight()`
  aborts a run that cannot see the private day (an unsplit env string once pointed
  orion-reschedule at the real calendar — it changed nothing, verified).
- Eval sessions' keys start `agent:main:orion-eval-sched-`; the V3 sandbox writes nothing to
  `~/.openclaw/orion-controlled` except `reschedule.lock` (a shared mutex, harmless).

---

## 7. Open items for Nick
- Battery session timing (Phase 7).
- Supervised live day go-ahead (Phase 8b).
- Optional downloads (qwen3.5:2b, qwen3.5:35b-a3b — the MoE could win scheduling on speed).
- Review ORION's capabilities with him (his request).
- Optional 20-case J1 label skim: `~/.openclaw/orion-controlled/evals/v3/review/j1-label-sample.md`.
