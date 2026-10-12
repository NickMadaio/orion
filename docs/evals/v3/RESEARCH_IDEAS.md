# What others do: 8 ideas for making ORION's local models work (research agent, 2026-10-12)

I found 8 ideas. The first comes from your own machine, not the web: your evaluations and your live system run the 9B worker with different settings. That gap alone could explain much of the "fine offline, broken live" pattern. I did not change any files; I only read config, logs and the installed OpenClaw code.

---

## 0. What I found on your machine

**1. The live worker probably runs with Ollama's default sampling settings, not your eval settings.**
- **Model defaults:** `ollama show qwen3.5:9b` reports `temperature 1`, `top_p 0.95`, `top_k 20`, `presence_penalty 1.5`, with thinking on by default.
- **What OpenClaw sends:** its Ollama client (`~/.openclaw/tools/node-v24.15.0/lib/node_modules/openclaw/dist/stream-DwcvMYU5.js`, around lines 291–335 and 708) only sends `temperature` or `presence_penalty` if the per-model `params` set them, or the run passes a temperature.
- **Your config:** in `~/.openclaw/openclaw.json` the model entry `"ollama/qwen3.5:9b": {}` is empty.
- **Your evals:** `scripts/lib/agentic/*.mjs` and the bench scripts use temperature 0–0.2.

So offline, the 9B is near-deterministic. Live, it most likely samples at temperature 1.0 with a presence penalty of 1.5. A presence penalty pushes the model away from tokens it has already seen. Tool calls need exactly those tokens copied back: absolute paths, class titles like "Discrete Structures", dates, flags.

Qwen's own model card says to use presence_penalty 0.0 and temperature 0.6 for precise work, and 1.5 only for general chat ([Qwen3.5-9B card](https://huggingface.co/Qwen/Qwen3.5-9B)). I have not seen the exact live payload, so this is a strong hypothesis, not a proof. To confirm it, set `OLLAMA_DEBUG_LOG_REQUESTS=1` (the setting exists in your server config) and replay one turn.

**2. The tool-call format is disputed for Qwen3.5 on Ollama.**
- Your model uses Ollama's `RENDERER qwen3.5 / PARSER qwen3.5`.
- Qwen's card serves it with `--tool-call-parser qwen3_coder`, an XML-style format.
- [ollama#14493](https://github.com/ollama/ollama/issues/14493) (still open; people reported problems through September 2026) argues the model was trained on the XML format and Ollama sends a JSON-style one.
- [ollama#14745](https://github.com/ollama/ollama/issues/14745) reports the 9B printing tool calls as plain text instead of making them.

The evidence is mixed: a maintainer showed working tool calls. It is still a plausible cause of "said let me book that and stopped".

**3. Models keep reloading.**
- The Ollama logs show the models being loaded with context sizes of 2048, 4096, 8192, 16384, 32768 and 65536. Your front desk asks for 16k and other callers ask for other sizes.
- Ollama reloads a model whenever the context size changes, which throws away its cached prompt.
- There are 138 "evicting" events, and `OLLAMA_KEEP_ALIVE` is 5 minutes.
- There are also 42 cases where a run filled the whole context (`truncated = 1`), one with a 32,506-token prompt in a 32,768 slot. That looks like runaway generation or thinking.

None of this fixes reasoning, but it accounts for much of the timeouts and GPU contention.

---

## The ideas

### Idea 1: Run live with the same settings and serving as the eval (effort S)

**Idea.** Pin the worker's sampling settings, context size and tool format, and make the eval use the identical payload path.

**Evidence.** Section 0 above, the Qwen card, and the two Ollama issues. Anthropic's ["Writing effective tools for agents"](https://www.anthropic.com/engineering/writing-tools-for-agents) stresses evaluating on the real workflow surface.

**Failures it targets.**
- Wrong date syntax, mangled titles, refusals of paths you just gave it: temperature 1 plus the presence penalty make exact copying unreliable.
- "Let me book that" then stopping: a tool call emitted as text by a mismatched renderer looks exactly like this.
- Timeouts: reloads and evictions.

**How to do it in ORION.**
1. In `openclaw.json`, give `ollama/qwen3.5:9b` these params: `{temperature: 0.2–0.6, presence_penalty: 0, top_k: 20, num_ctx: 32768, keep_alive: "-1"}`. Give the front desk the same `num_ctx`, or create two Modelfile variants with the context size baked in so nothing renegotiates it.
2. Set `OLLAMA_MAX_LOADED_MODELS=2`. Keep thinking off for the worker on scheduling turns, or cap `num_predict`.
3. A/B the tool format: the same 25 golden turns through (a) Ollama `qwen3.5` renderer, (b) a Modelfile override `RENDERER qwen3-coder / PARSER qwen3-coder`, (c) `llama-server --jinja` using the GGUF's own template. Pick whichever gets the most valid structured `tool_calls`.

**Risks.** Lower temperature can cause loops; Qwen warns against greedy decoding in thinking mode, so use 0.2–0.6 rather than 0. The qwen3-coder override reportedly leaks `<think>` text into the reply. Either way, this is an hour of work.

---

### Idea 2: Run scheduling as a fixed sequence in code, not an open-ended model loop (effort M)

**Idea.** For the few things Nick actually asks of his calendar, stop letting the 9B drive. Code reads the day, the model fills one small typed slot, code builds and runs the command, then the model writes one sentence. You get a state machine with a model inside it, not a model with tools around it.

**Evidence.**
- **TinyAgent** (Berkeley, EMNLP 2024 demo), a local Siri-like assistant on a MacBook: the model only chooses a plan over 16 predefined AppleScript functions. A 1.1B model went from 12.7% to 78.9% after fine-tuning, matching GPT-4-Turbo at 79% ([blog](https://bair.berkeley.edu/blog/2024/05/29/tiny-agent), [paper](https://arxiv.org/pdf/2409.00608)).
- **Apple's on-device ~3B model** is built the same way. Tools take typed `@Generable` arguments and output is constrained to them ("guided generation"). Apple positions the model for narrow tasks, not open-ended agent work ([docs](https://developer.apple.com/documentation/foundationmodels.md), [tech report](https://machinelearning.apple.com/research/apple-intelligence-foundation-language-models)).
- **Microsoft's SMCalFlow** treats calendar requests as parsing into an executable program over the current calendar state ([constrained few-shot parsers](https://arxiv.org/pdf/2104.08768)).
- **Natural Language Tools** ([arXiv 2510.14453](https://arxiv.org/abs/2510.14453v1)): separating "which action" from "write the arguments" raised tool accuracy about 18 points, with the biggest gains on open-weight models. The evidence is weak for arguments: that study only covers choosing a tool with no parameters.

**Failures it targets.**
- Bare script names, wrong door (`tool_call` vs `exec`), the `&` guard, date syntax: the model never writes a path or a shell string.
- Misidentified classes: the model picks from an enum of today's real block IDs, each shown with its times. It cannot invent a block.
- Asking Nick for times it could read: code has already read the calendar and put it in front of the model.
- Front desk calling it a question: for scheduling, the front desk can output the typed intent itself, since it is already JSON-constrained.

**How to do it in ORION.**
1. In the plugin's local route, when the message is about scheduling, code calls `orion-reschedule day --plan` (or the calendar read) and builds a numbered block list: `B3 = Discrete Structures 10:00–12:20`, `B5 = Lab 15:30–17:20`, and so on.
2. One constrained Ollama `/api/chat` call with `format` set to a JSON schema. The block IDs are `enum`s generated per request, and the verb is `enum` over the ~15 CLI verbs plus `cant` and `ask`.
3. This is your "steps form", made stricter by the per-request enums: for example `{do:"fill_between", what:"cert courses", after:"B3", before:"B5"}`.
4. Code maps the intent to the exact argv. No shell string is ever built, so the `&` problem disappears. Code then runs the scheduler.
5. A second small call (or a template) speaks the result.

**Risks.** Requests that do not fit the intent types need an escape hatch: fall back to today's loop, or to Claude. Keep the agent loop for the long tail and send the 80% case through the fixed path. It also needs a multi-step variant for "rebuild my afternoon": a list of intents, compiled in order.

---

### Idea 3: Add intent-level verbs, and use the scheduler as the model's checker (effort M)

**Idea.** Add verbs that match how Nick talks, such as `fill_between(A, B, what)`, `stay_on_campus`, `free_up(until)`. Run every change through a dry run that returns a structured before/after diff. Rule violations go back to the model as specific, fixable messages.

**Evidence.**
- Kambhampati's [LLM-Modulo](https://arxiv.org/abs/2402.01817) (ICML 2024): models are poor planners alone but useful generators inside a loop with sound external checkers.
- DeepMind's [NATURAL PLAN](https://arxiv.org/pdf/2406.04520) shows even frontier models are weak at calendar-style constraint problems as constraints grow. The 2025 follow-up work moves the arithmetic into code or the Z3 solver.
- Anthropic's tool guide: build tools around workflows (their example is a `schedule_event` that finds availability and books it), return high-signal context, write "actionable" error messages.

**Failures it targets.** Your target request is one call: `fill_between B3 B5 "cert courses"`, which the scheduler resolves to 12:35–15:25. The model never computes a time. It also explains why your "rewrite the whole day as JSON" experiment scored 6/25: it asked the model to do arithmetic, the one thing every source says to keep in code.

**How to do it in ORION.**
1. Add `fill-between` (and a dry-run flag on every verb) to `orion-reschedule`.
2. Have the scheduler return JSON: `{ok, changes:[{block, from, to}], conflicts:[…], message}`.
3. The work check compares the reply against this diff instead of parsing free text.

**Risks.** Every new verb needs scheduler code and tests. Keep it to the five or so verbs that cover most of Nick's real messages; mine the logs to find them.

---

### Idea 4: Propose, preview, commit, with a state object that outlives the turn (effort S–M)

**Idea.** A scheduling turn ends with a stored proposal object (intent, argv, dry-run diff), never with the model's prose. Commit is a separate step: automatic when the change is small and has no conflicts, otherwise Nick taps approve on the iPhone. "Yes do it" then executes the stored argv directly instead of asking the model to rebuild it.

**Evidence.** This is Terraform's plan/apply and the "sandbox preview" agent UX pattern ([aiuxplayground](https://aiuxplayground.com/pattern/sandbox-preview)). Evidence that it improves small models specifically is weak. The argument is structural: it takes the commit step away from the model.

**Failures it targets.** "Said let me book that and stopped", approval follow-ups that lose context, false "done" claims. The reply is generated from the diff, so it cannot claim something that did not happen.

**How to do it in ORION.** You already have `approvals.ts` and a work check. Store the proposal keyed by conversation. The front desk's "approval → escalate" path becomes "approval → code commits the pending argv", with no model call at all.

**Risks.** It needs a stale-proposal check: re-run the dry run before committing in case the calendar changed.

---

### Idea 5: Record and replay real successful traces as examples (effort S–M)

**Idea.** Keep a store of (Nick's message, calendar snapshot, correct intent or command, outcome) from successful turns: Claude-handled turns, corrected failures, and turns Nick approved. For each new request, retrieve the 2–3 nearest and insert them as example message pairs.

**Evidence.**
- [AgentRR](https://arxiv.org/pdf/2505.17716) (2025) proposes exactly this: a large model records runs, a small on-device model replays them, with a check function as a safety guard.
- LangChain's [few-shot tool-calling study](https://blog.langchain.com/few-shot-prompting-to-improve-tool-calling-performance) found example messages selected by similarity improved tool calling. I could not verify the exact numbers.
- TinyAgent retrieves in-context examples alongside tools, but reports no separate ablation.

**Failures it targets.** "Stay in the building / no commute / the entire time between" is idiomatic Nick-speak. One stored example mapping that phrasing to `fill_between` does more than prompt text. It also gives the 4B a precedent for "this phrasing means scheduling, not a question".

**How to do it in ORION.** You already have `nomic-embed-text` and an episodic store (`episodic.ts`). Add an `exemplars.jsonl` filled from the outcome ledger, plus hand-written fixes for every live failure. Retrieve by embedding, and keep the examples in the same typed format as Idea 2.

**Risks.** Stale or wrong examples get copied faithfully. Only store examples that passed the work check and that Nick did not undo.

---

### Idea 6: An eval that replays production exactly (effort M, and it unlocks everything else)

**Idea.** Your eval overstated live quality because it used a different tool surface, different sampling settings and different context. Build the eval as a replay of production: the real OpenClaw turn and the real plugin, against a frozen calendar snapshot, with side effects pointed at a scratch calendar, logging the exact Ollama payloads.

**Evidence.** Anthropic's tool guide: tasks drawn from real workflows, verifiable outcomes, held-out sets, tracking tool-call errors and runtime. Every failure on your live list (path refused, wrong door, exec guard, the 5-minute timeout) lives in parts the sandbox did not include.

**How to do it in ORION.**
1. Take the last N real scheduling messages from the local-routing log plus the calendar state at that time.
2. Run them through the installed gateway in a test profile that sends calendar writes to a scratch calendar.
3. Score the final calendar diff against the expected one, not the reply text, and include wall-clock time.
4. Gate any routing change on this. It also becomes the test harness for Ideas 1–5.

**Risks.** Snapshotting the calendar and stubbing side effects takes plumbing work. Start with 25 real requests, including the cert-courses one.

---

### Idea 7: Distill from a big model and LoRA-tune the 9B (or 4B) on the narrow format (effort L)

**Idea.** Once Idea 2 shrinks the model's job to "message + numbered blocks → typed intent", fine-tune for exactly that. A big model (Claude, or your local qwen3.6:27b or gpt-oss:20b) labels thousands of synthetic variations of Nick's real requests over real calendar snapshots. Code checks each label by running the scheduler's dry run. Then train a LoRA on Mac with `mlx-lm`.

**Evidence.**
- TinyAgent: 80k examples generated by GPT-4-Turbo (about $500), with automatic sanity checks. 1.1B went from 12.7% to 78.9%, 7B from 41% to 83%, and 4-bit quantization cost no accuracy.
- [α-UMi](https://arxiv.org/html/2401.07324v2) (EMNLP 2024), "Small LLMs Are Weak Tool Learners": splitting planner, caller and summarizer and fine-tuning each beat a single small model.
- Tooling exists: `mlx_lm.lora` and [mlx-lm-lora](https://github.com/Goekdeniz-Guelmez/mlx-lm-lora).

**Failures it targets.** Phrasing quirks, choosing the right two classes, and the model never saying "can't". Teach that with explicit `cant` examples.

**Risks.** Serving is the catch. A LoRA trained on MLX safetensors needs converting to load into Ollama's GGUF path, or you serve the worker from `mlx_lm.server`. The work is also wasted if the output format changes, so only do this after Idea 2 settles, and only if Ideas 1, 2 and 5 leave a meaningful gap.

---

### Idea 8: Hardware and serving: resident models, stable prompt start, MLX backend (effort S–M)

**Idea.** On 48 GB, keep exactly two models loaded (the 4B and the 9B) at fixed context sizes with `keep_alive -1`. Keep the system prompt and tool block byte-identical at the start of each request so the prompt cache is reused. Put changing content (time, brain results, examples) after the stable part. Then test Ollama's MLX backend.

**Evidence.** Ollama's MLX engine (0.19+) reported prefill going from about 1,154 to 1,810 tokens/s and decode from 58 to 112 tokens/s on Qwen3.5-35B-A3B. It only applies to safetensors/MLX builds, not GGUF; your logs show the llama-server GGUF path ([Ollama blog](https://registry.ollama.ai/blog/mlx)). Independent comparisons say the gain over raw llama.cpp is smaller, and time to first token at long contexts is mixed.

**Failures it targets.** The 5-minute timeouts and GPU contention (138 evictions in the logs). Heavier jobs (the 27B or the reviewer models) should take a lock or be scheduled so they never evict the worker during a live turn.

**Risks.** The MLX builds may not support tools or thinking the same way as GGUF. Run the Idea 6 replay before switching.

---

## Ranking (impact for effort)

| Rank | Idea | Effort | Expected impact |
|---|---|---|---|
| 1 | Idea 1: same settings and serving live as in eval | S | High if the hypothesis holds; nearly free to test |
| 2 | Idea 6: production-replay eval (25-request version) | M | Enabling; stops the eval overstating live quality |
| 3 | Idea 2: scheduling as a fixed sequence in code | M | Removes most of the listed live failure types by construction |
| 4 | Idea 3: intent verbs plus scheduler as checker | M | Makes the target request a single call |
| 5 | Idea 5: replay real successful traces | S–M | Good for Nick's phrasing; cheap once the ledger exists |
| 6 | Idea 4: propose, preview, commit | S–M | Fixes "stopped after saying it" and approval follow-ups |
| 7 | Idea 8: resident models and MLX | S–M | Latency and timeouts, not correctness |
| 8 | Idea 7: distillation plus LoRA | L | Potentially large, but only after the format is fixed |

## Try these first, cheaply and offline

1. **Settings A/B (Idea 1), about 2 hours.**
   - Turn on `OLLAMA_DEBUG_LOG_REQUESTS`, send one live scheduling turn, and read the actual `options`, `think` and rendered tool block.
   - Then run the existing 25 scheduling cases straight against `/api/chat` with the exact live payload in four configurations: (Modelfile defaults vs temperature 0.4 / presence 0) × (`qwen3.5` vs `qwen3-coder` renderer).
   - If the defaults-plus-qwen3.5 cell drops well below your 64%, you have found a large part of the eval/live gap.

2. **The fixed sequence plus enums on the cert-courses case (Ideas 2 and 3), about a day.**
   - Write the block-numbering step and the per-request JSON schema with enums. Call the 9B (and the 4B) through `format`.
   - Score only the intent JSON against hand labels on the 25 cases plus your 10 real failed messages. No execution is needed; argv building is deterministic and unit-tested.
   - If the 4B gets it right, the front desk can absorb scheduling intents and skip the worker.

3. **Seed the example store (Idea 5) on the same set.** Add the best 2–3 hand-corrected examples to the Idea 2 call and measure the change. It costs nothing more once step 2 runs.

Only after these pass offline: point the replay harness (Idea 6) at the real gateway with a scratch calendar, then go live in shadow mode.

**Where the evidence is weak:**
- The sampling-settings diagnosis rests on reading OpenClaw's code; I have not captured a live payload.
- The renderer bug is disputed upstream.
- The Natural Language Tools gains only cover choosing a tool, not filling arguments.
- The MLX speedups are vendor benchmarks on a different model.
- TinyAgent's numbers are the authors' own benchmark on their 16 tools.

The structural argument (keep the model away from paths, shell strings and time arithmetic) is the one every source agrees on.

### Sources
- [TinyAgent paper](https://arxiv.org/pdf/2409.00608), [BAIR blog](https://bair.berkeley.edu/blog/2024/05/29/tiny-agent), [GitHub](https://github.com/SqueezeAILab/TinyAgent)
- [Anthropic: Writing effective tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Less is More: tool selection on edge devices](https://arxiv.org/pdf/2411.15399)
- [Natural Language Tools](https://arxiv.org/abs/2510.14453v1)
- [Apple Foundation Models docs](https://developer.apple.com/documentation/foundationmodels.md), [Apple FM research](https://machinelearning.apple.com/research/apple-intelligence-foundation-language-models)
- [Qwen3.5-9B model card](https://huggingface.co/Qwen/Qwen3.5-9B)
- [ollama#14493](https://github.com/ollama/ollama/issues/14493), [ollama#14745](https://github.com/ollama/ollama/issues/14745), [zeroclaw#3079](https://github.com/zeroclaw-labs/zeroclaw/issues/3079)
- [LLM-Modulo](https://arxiv.org/abs/2402.01817), [NATURAL PLAN](https://arxiv.org/pdf/2406.04520)
- [SMCalFlow constrained parsers](https://arxiv.org/pdf/2104.08768)
- [AgentRR](https://arxiv.org/pdf/2505.17716)
- [LangChain few-shot tool calling](https://blog.langchain.com/few-shot-prompting-to-improve-tool-calling-performance)
- [α-UMi, Small LLMs Are Weak Tool Learners](https://arxiv.org/html/2401.07324v2)
- [mlx-lm-lora](https://github.com/Goekdeniz-Guelmez/mlx-lm-lora)
- [Ollama MLX blog](https://registry.ollama.ai/blog/mlx)
- [llama.cpp llguidance docs](https://huggingface.co/spaces/YZ-TAN/flask-llama/raw/main/llama.cpp/docs/llguidance.md)
- [Sandbox preview pattern](https://aiuxplayground.com/pattern/sandbox-preview)

Local files referenced: `/Users/nickmadaio/.openclaw/openclaw.json`, `/Users/nickmadaio/.openclaw/tools/node-v24.15.0/lib/node_modules/openclaw/dist/stream-DwcvMYU5.js`, `/Users/nickmadaio/.ollama/logs/server.log`, `/Users/nickmadaio/Desktop/ORION/scripts/lib/agentic/settings.mjs`, `/Users/nickmadaio/Desktop/ORION/plugin/orion-control/src/front-desk.ts`.
