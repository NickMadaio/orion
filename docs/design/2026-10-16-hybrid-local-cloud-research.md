# Hybrid local + cloud agents: research and ORION recommendation (2026-10-16)

Scope: how practitioners mix 4B-14B local models with cloud models, whether it pays off, and what that means for ORION (qwen3.5 4B front desk, qwen3.5 9B worker, code-run flows, M5 Pro 48 GB, voice latency, near-zero cost).

Evidence quality legend: [P] primary paper or official doc, [V] vendor or aggregator page, [B] blog/forum/anecdote. Several numbers below came from search-result summaries and third-party mirrors; items marked UNVERIFIED should be re-checked before anyone relies on them.

## 1. Common hybrid patterns

| Pattern | Idea | Routing signal | Examples |
|---|---|---|---|
| Router (pre-hoc) | Classifier picks small vs large model before generating | Learned difficulty/win-probability from preference data | RouteLLM [P], Hybrid LLM (Microsoft, ICLR 2024) [P] |
| Cascade (post-hoc) | Try cheap model, escalate if answer looks bad | Scorer on the answer, self-confidence, validation failure | FrugalGPT [P] |
| Speculative cascade | Small model drafts, large model verifies in parallel and decides whether to defer | Token-level deferral rule | Google "Faster Cascades via Speculative Decoding", ICLR 2025 [P] |
| Cloud planner + local executor | Big model decomposes, small local model does bulk reading or tool work | Task structure (fixed by design) | Minions (Stanford/Together) [P] |
| Local-first with cloud fallback | Run everything local, go to cloud on failure, timeout, or explicit user ask | Failure detection, user intent | Home Assistant Assist-first then LLM [B] |
| Deterministic-first | Intent matcher/code handles known commands, LLM only for the rest | Task type, pattern match | Home Assistant Assist pipeline [B]; ORION's code-run flows already do this |

Signals practitioners route on: (a) trained classifier on query text (RouteLLM, Hybrid LLM); (b) task type or tool domain (rule-based, cheapest and most predictable); (c) output validation (schema parse fails, tool name not in registry, args fail validation, loop detected); (d) model self-confidence or a verifier score (FrugalGPT's scorer; works but verbalized confidence from small models is poorly calibrated); (e) explicit user cues ("think harder", "look it up").

Notes on named systems:
- RouteLLM: trained on Chatbot Arena preference data, evaluated GPT-4 Turbo vs Mixtral 8x7B. https://lmsys.org/blog/2024-07-01-routellm/ , code https://github.com/lm-sys/RouteLLM [P]
- FrugalGPT: https://arxiv.org/abs/2305.05176 [P]
- Hybrid LLM: https://arxiv.org/abs/2404.14618 , https://proceedings.iclr.cc/paper_files/paper/2024/hash/b47d93c99fa22ac0b377578af0a1f63a-Abstract-Conference.html [P]
- Speculative cascades: https://research.google/blog/speculative-cascades-a-hybrid-approach-for-smarter-faster-llm-inference/ , https://arxiv.org/abs/2405.19261 [P]
- Minions: https://arxiv.org/abs/2502.15964 [P]
- Apple Intelligence: ~3B on-device model plus a server model on Private Cloud Compute; the tech report describes the models but I found NO public detail on the routing logic. https://machinelearning.apple.com/research/apple-foundation-models-tech-report-2025 , https://arxiv.org/abs/2507.13575 [P]. Treat "Apple routes by X" claims as unsupported.
- Home Assistant: Assist intent matching first, LLM only if no match; docs recommend small models with few exposed entities (< 25 for llama3.1 8B) and warn small models make more mistakes. https://www.home-assistant.io/integrations/ollama [P/official]; two-tier description https://insiderllm.com/guides/home-assistant-local-llm-guide/ [B]
- Open Interpreter: I did not find a measured write-up of a hybrid design; not cited. Gap.

## 2. Measured benefits

Routing studies (all are best-case "up to" figures, and measured against expensive frontier baselines, which is NOT ORION's situation):
- RouteLLM: >85% cost reduction on MT-Bench, ~45% on MMLU, ~35% on GSM8K while keeping ~95% of GPT-4 quality. Savings shrink sharply on knowledge/math tasks. https://lmsys.org/blog/2024-07-01-routellm/ [P]
- Hybrid LLM: up to 40% fewer large-model calls with no quality drop. https://arxiv.org/abs/2404.14618 [P]
- FrugalGPT: up to 98% cost cut at GPT-4 parity, or +4% accuracy at equal cost; best case only. https://arxiv.org/abs/2305.05176 [P]
- Minions: remote-only quality ~98% retained at ~5.7x lower cloud cost; naive local-remote chat protocol ~30x cheaper but ~87% quality. Designed for long-document reading, not tool use. https://arxiv.org/abs/2502.15964 [P]

Key point: these studies save money by moving traffic OFF an expensive model. ORION is already at ~$0, and the cloud candidates cost ~$0.05-0.40 per million tokens. Cost savings from routing are irrelevant for ORION; the only live questions are quality and latency.

Latency, cloud vs local for short turns:
- Gemini 2.5 Flash-Lite: ~0.3 s P50 TTFT on live gateway traffic (Vercel AI Gateway) [V], ~230 tok/s output on AI Studio (Artificial Analysis) [V]. https://vercel.com/ai-gateway/models/gemini-2.5-flash-lite , https://artificialanalysis.ai/models/gemini-2-5-flash-lite/providers
- GPT-5 nano is a reasoning model: Artificial Analysis lists ~0.8 s time to first answer token at minimal effort (page marked deprecated); forum reports of ~1 s first-token for gpt-5-mini and users finding nano slower than gpt-4o-mini. Default reasoning effort can add seconds. https://artificialanalysis.ai/models/gpt-5-nano-minimal/providers , https://community.openai.com/t/gpt-5-is-very-slow-compared-to-4-1-responses-api/1337859 [V/B]
- Voice pipeline budgets: ~700 ms-1.2 s end-to-end target; LLM stage budgeted 300-600 ms TTFT; a cloud GPT-4o-class TTFT of ~820 ms p50 was cited. Network adds 50-150 ms; endpointing 150-400 ms. https://soniox.com/wiki/voice-agent-latency-budget , https://deepgram.com/learn/voice-agent-architecture-stt-llm-tts-pipeline-design [V]
- Local: Home Assistant reports warm local commands in a few hundred ms on GPU, and model reliability (71%-96% on a 24-command set) mattered more than speed. https://techfuelhq.com/tutorials/home-assistant-local-llm-voice-2026/ [B]. Throughput figures for Qwen 3.5 4B/9B Q4 on RTX 3060 (~24/~15 tok/s) are from [B] and say little about an M5 Pro; ORION should use its own measurements.
- Inference for ORION: a cloud call costs roughly 0.3-1 s TTFT plus network, on top of whatever the local front desk spent deciding to escalate. It is competitive with a local 9B for a first token but NOT faster than a warm local 4B, and it adds variance (tail latency, outages, rate limits).
- Third-party latency evidence is thin and mostly vendor/blog. No source measured a local-vs-cloud hybrid in a voice loop end to end.

## 3. Tool calling: small local vs small cloud

- BFCL mirrors (not the official leaderboard; UNVERIFIED): Qwen3-4B-Instruct-2507 ~35.7 overall (non-live AST ~87.9, multi-turn ~22.1); Qwen3-8B FC ~42.6; Qwen3-14B FC ~41.0. https://benchmarklist.com/models/qwen3-4b-instruct-2507/ , https://www.datalearner.com/leaderboards/external/berkeley-fc?isChina=1 [V]. Pattern worth trusting: single-call AST accuracy is high even at 4B, multi-turn is the weak spot, and size from 4B to 14B moves the overall score little. I did not obtain comparable BFCL rows for Gemini 2.5 Flash-Lite, GPT-5 nano or DeepSeek; check https://gorilla.cs.berkeley.edu/leaderboard.html directly.
- A 2026 paper "Small Reasoning Models are Instruction Followers in Function Calling" exists (arXiv 2608.22472) but I only saw its title. UNVERIFIED, not relied on.
- Tool count: HumanMCP found GPT-4o-mini, Claude 3.5 Haiku and Gemini 2.0 Flash each lose ~9-10 points of tool retrieval hit rate going from 10 to 100 candidate tools [P]. https://arxiv.org/abs/2602.23367 . Secondhand claims (Llama 3.1 8B failing with 46 tools but passing with 19; RAG-MCP 13.6% vs 43% with retrieval) come from blogs: https://tianpan.co/blog/2026/04/19/over-tooled-agent-problem , https://www.stackone.com/blog/agent-tool-count-ceiling/ [B]. Confusable, similarly described tools matter more than raw count.
- Home Assistant guidance: keep exposed entities low (< 25) for 8B models; ~40 devices gave ~6k-token prompts. https://www.home-assistant.io/integrations/ollama [P/official], [B] Reddit.
- Local failure modes seen in practice [B]: chat template dropping the tools block (check with OLLAMA_DEBUG=1 that tool schemas appear in the rendered prompt); answering from memory instead of calling; looping or refusing to call tools more than a couple of times; tool-call chunks dropped on Ollama's /v1 streaming path (use native /api/chat). Sources: https://lemmy.korz.dev/post/1687449 , https://community.agno.com/t/agents-running-through-ollama-not-able-to-call-tools/1326 , https://www.betterclaw.io/tools/agent-error-decoder/ollama-does-not-support-tools
- Mitigations reported: schema validation plus retry-with-error-feedback, auto-repair of near-miss parameter names, trimming tool descriptions and system prompts (e.g. https://github.com/filthyrake/filthy-tool-fixer [B]).

## 4. Making local agents fast

- Ollama reuses KV for a shared prompt prefix while the model stays loaded; default unload after 5 min, so set keep_alive (-1) to keep both model and cache resident. https://leanpub.com/read/ollama/prompt-caching [B]; verify against official Ollama docs.
- llama.cpp server: per-slot prompt cache (cache_prompt), prefix match via longest common prefix; slot selection can be suboptimal and with more distinct prompts than slots reuse is rare. https://github.com/ggml-org/llama.cpp/discussions/13606 [B/maintainer discussion]. Implication: front desk and worker have different prompts, so give each its own resident model and slot; do not alternate prompts on one slot.
- Prompt design for caching: static content first (system prompt, tool schemas), volatile content (time, memory, user turn) last. Any change early in the prompt invalidates the whole cache.
- Avoid model swaps: 4B + 9B Q4 both fit easily in 48 GB; keep both loaded (OLLAMA_MAX_LOADED_MODELS, keep_alive).
- Small tool schemas, and expose only the tools relevant to the routed domain (the code-run flows already shrink this; extend to per-domain tool subsets).
- Constrained decoding: JSON-schema/grammar enforcement (Ollama `format`, llama.cpp grammars) gives near-100% parse validity; overhead is negligible with modern engines (XGrammar, llguidance) but varies by implementation. Field order matters (put reasoning/choice fields in a sensible order). https://arxiv.org/abs/2501.10868 [P]; https://dev.to/jangwook_kim_e31e7291ad98/ollama-structured-outputs-in-practice-getting-type-safe-json-from-local-llms-with-pydantic-m38 [B]. Parse validity does not guarantee the right tool or args.
- Single-pass designs: merge "decide move" and "emit tool call" into one constrained call for the common case; keep a separate front desk only if it is measurably cheaper than the worker's prefill. Stream to TTS at clause boundaries so time-to-first-sentence, not total generation time, is what the user feels.
- Disable thinking for qwen3.x in the voice path (thinking tokens add seconds).

## Recommendation for ORION

Stay local-first and 100% local for the voice hot path. Spend effort on speed and reliability; add a narrow, optional cloud tier rather than a general router.

Why:
1. Routing literature's savings do not apply: ORION has no expensive baseline to displace.
2. Cloud is not faster than a warm local 4B/9B for short turns: ~0.3 s (Flash-Lite) to ~1 s (GPT-5 nano with reasoning) TTFT plus network, plus the time the local front desk already spent classifying. It also adds tail latency and an availability dependency.
3. Cloud small models do not clearly beat local 9B on tool calling; BFCL-style numbers cluster, and both degrade with tool count and long prompts. The fixes (fewer tools per call, validation, constrained output, caching) apply equally.
4. Deterministic code-run flows for calendar/reminders/focus already capture the highest-volume, latency-critical turns.

Where an escalation tier could help (only these):
- Open-ended knowledge, explanation, summarization of long text, drafting, multi-step reasoning the 9B answers badly. Not tool turns.
- Recovery: the worker fails validation twice (bad tool name, invalid args, loop) on a non-latency-critical turn.
- Explicit user ask ("look into", "think about this").
Escalate on rule-based signals (front-desk "escalate" move, validation failures, explicit phrasing), not on a learned router or self-confidence. Say a short filler ("let me think") locally while the cloud call runs. Prefer Gemini 2.5 Flash-Lite as default (lowest TTFT evidence, no reasoning overhead); use GPT-5 nano only with minimal reasoning effort; DeepSeek has less favorable latency/location and its price listings conflict ($0.28/$0.42 vs $0.56/$1.68 per M tokens; verify).

Expected cost (Flash-Lite $0.10 in / $0.40 out per M tokens [V], https://anotherwrapper.com/llm-pricing/gemini-2.5-flash-lite ; GPT-5 nano $0.05/$0.40): a 3k-token-in, 300-token-out escalation is about $0.0004 (Flash-Lite). Even 50 escalations a day is roughly $0.02/day, about $0.60/month. Cost is not the constraint; privacy and latency are (personal calendar/reminder data should be filtered before leaving the machine).
Expected latency for escalated turns: ~1-2.5 s to first spoken word (local classify + network + TTFT + first clause), versus a few hundred ms to ~1 s local. Acceptable only for the turn types above.

Concrete next steps (in priority order):
1. Measure first: per-turn timings for front desk prefill/decode, worker prefill/decode, tool run, TTS start; log prompt token counts and cache hit (Ollama reports prompt_eval_count/duration). Decide on data.
2. Verify the tools block is actually in the rendered prompt (OLLAMA_DEBUG=1), use native /api/chat, keep_alive=-1 for both models, thinking off.
3. Stable-prefix prompt ordering; per-domain tool subsets; trim descriptions.
4. Constrained output for the front-desk move; validation + one retry with error feedback for worker tool calls.
5. Build a small ORION eval set (real transcripts, ~100 turns) scoring tool choice/args and answer quality. Run it on local 9B and on Flash-Lite/nano/DeepSeek. Only wire in the escalation tier if the cloud models show a clear win on the open-ended and failure-recovery buckets.

## Gaps and caveats
- No measured local+cloud hybrid in a voice loop found; latency conclusions are inferred from component numbers.
- BFCL numbers are from mirrors; no cloud-vs-local BFCL comparison obtained for the three candidate cloud models.
- Apple routing logic and Open Interpreter hybrid evidence not found.
- Many practitioner claims are forum/blog level and flagged [B].
