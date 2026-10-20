# Why the local models failed live, and how to fix each (2026-10-12)

Written by Claude for Nick (and any assistant he works with next). Evidence: session transcripts in
`~/.openclaw/agents/main/sessions/`, the routing log `~/.openclaw/orion-controlled/local-routing/shadow.jsonl`,
the gateway log `~/Library/Logs/openclaw/gateway.log`, and `HANDOFF.md`.

The test request throughout: *"change of plans. ill stay in the building between discreet structures and
my lab for program design, so no commute time, and then while im there please schedule me for cert
courses the entire time between the two classes."* The right answer is one command:
`orion-reschedule move "do cert courses" --after "CS1800" --before "CS2101"` → 12:35–15:25 (verified by dry run).

## How a turn works today (for reading the code)

1. Phone / Mac chat / voice → OpenClaw gateway (`~/.openclaw/openclaw.json`; phone goes through `scripts/orion-remote`).
2. The `orion-control` plugin (`plugin/orion-control/src`) hooks the turn. With `localRouting` on:
   `front-desk.ts` (qwen3.5:4b) picks a move → `local-routing.ts` sends the turn to qwen3.5:9b with a slim
   system prompt (tuned job instructions + production notes + brain pre-fetch) → the 9B calls tools
   (`exec` of `scripts/orion-*`, or the catalog via `tool_call`) → `work-check.ts` checks the answer and can
   ask for one retry, then an honest stop.
3. Without `localRouting` on, the gateway uses Claude Haiku with the full workspace prompt
   (`~/.openclaw/workspace/*.md`, source `plugin/workspace/`), falling back to qwen3.5:9b and llama3.2:3b.

## Failures seen, and the fix for each

| # | What went wrong | Seen as | Fix | Status |
|---|---|---|---|---|
| 1 | **The model has to write shell-like command strings** for `exec`: bare script names are refused (full path only), `orion-agenda tomorrow` / `--date tomorrow` were invalid, `&` in a class title is refused | 4 failed calls before giving up (2026-10-11) | Give the local model **one typed tool per job** (e.g. `schedule_change {steps:[{do:"move", title, after, before}]}`); code builds the exact command. Prototype: `scripts/eval/v3/ops/steps.mjs` | scripts now accept day words; typed tool not built |
| 2 | **Two tool doors**: `exec` and the catalog (`tool_call`); the 9B called `orion-agenda` through `tool_call` | "Unknown tool id: orion-agenda" (2026-10-12) | Same as 1 — expose only the typed job tools to the local worker | not built |
| 3 | **Huge context**: the full workspace prompt (~17k tokens) + whole chat history on every call | 68k–579k input tokens per turn, 60–300 s, run-budget timeouts | Slim core prompt + brain lookups (done for the local worker); keep only the last few turns of history | core done; history trim not built |
| 4 | **AGENTS.md truncated** at 20,000 chars (it is 31k): Dates, Memory and Brain, Safety and communication never reached Claude | silent | Manual moved into the brain (`scripts/orion-brain-manual`, 53 notes); AGENTS.md opens with a look-it-up section. Optional: raise `agents.defaults.bootstrapMaxChars` | done (raise limit: Nick's call) |
| 5 | **Course codes matched loosely**: "CS2101" matched the CS2100 lecture (words cut to 5 letters) | move would have run past midnight | Codes stay whole in `orion-reschedule` matching | fixed + test |
| 6 | **Front desk misroutes**: called the request "ask" or "answer" | the 9B only got a drafted question and asked Nick for times | Change requests always go to the worker with the job's instructions | fixed + test |
| 7 | **Asked instead of acting / "let me book that" and stopped** | 2 of 3 live tries | Work check flags both and retries with "do it now" | fixed + test |
| 8 | **Misread which classes** (filled 9–11 instead of DS→lab) | 1 live try | Decomposition: the model names the two anchor blocks; code finds their end/start (Nick: "start = when the class ends, end = when the lab starts") — the `move --after A --before B` step | prototype in steps.mjs |
| 9 | **Impossible requests not flagged** in the plan-the-whole-day variant | 4/4 practice cases | The model reports `cannot`; code reports NOT BOOKED from the scheduler | prototype |
| 10 | **Claude API out of credit** since 2026-10-11 19:23 ("credit balance too low", "usage limits … regain access 2026-11-01"): every Haiku turn failed, the gateway fell back to the 9B with the full prompt | timeouts blamed on the wrong layer | Top up credits / raise limit (Nick); account-health alert built in another session, awaiting deploy | Nick |
| 11 | **Eval ≠ production**: sandbox scripts by bare name, fixture tools, small prompts; eval scores overstated live quality | 89–100% eval vs 0/3 live | Gate: "on" needs a passing real-route acceptance (`local-acceptance.mjs`; ≥85%, ≤20 s, ≤14 days) or a deliberate `localRoutingTestingUntil` window | done |
| 12 | **GPU contention**: evaluation runs, the 4B, the 9B and brain embeddings at once | first model call timed out | Never run eval jobs while Nick is testing live; keep the two models warm | process rule |
| 13 | **The slim prompt silently lost**: the host cuts `before_prompt_build` off at 15 s, and a schedule flow with 9B form calls ran 22 s + 30 s inside it, so the host sent the full 17.7k-token workspace prompt (3 min 1 s on battery) | 4 min 40 s, nothing changed (2026-10-20) | Hook registered with its own timeout and bounded by a turn budget (`turn-budget.ts`); nothing written after the deadline; a change request still unanswered at 40 s gets an honest line | fixed + test |
| 14 | **"Reschedule my day, gym first after I get home" had no code owner**: the worker wrote resume-before-gym, gym 60 min, no trip home | same turn | `day-replan.ts` reads the order and the anchor; the existing `orion-reschedule day --plan` places it | fixed + test |

## Experiments (practice J3, 25 cases, qwen3.5:9b)

| Approach | Pass | Note |
|---|---|---|
| Drive `orion-reschedule` with tools (tuned prompt, thinking on) | 19/25 | the eval number; sandbox tool interface |
| Rewrite the whole day as JSON, code applies (`declarative.mjs`) | 6/25 | drifts lengths/times; never says "can't" |
| Steps as a typed form, code builds commands (`steps.mjs`) | not finished | 1 case run under GPU contention; harness bugs noted (to-do field misuse, reply merging rolled-back changes) |

## Recommended next build (in order)

1. A typed `schedule_change` tool (steps form) as the ONLY scheduling tool the local worker sees; code
   resolves anchors ("after DS", "before the lab") and runs the real scheduler; reply from its output.
2. History trimming for local turns (last 4 exchanges + one-line summary).
3. Re-run Phase 8 through the real route with `localRouting: on` until the acceptance gate passes.
