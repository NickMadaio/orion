# Why ORION's local models feel slow (measured, 2026-10-16)

Question (Nick): the 4B and 9B are fast on their own, but slow as molasses inside ORION. Real chat turns take a median 15.6 s (shadow log, 33 real turns; Nick quoted 15.8 s). Sweep turns take a median 6.3 s (370 turns since 10-15).

Method: read-only. Sources: shadow.jsonl and .trace, trajectory files, the gateway log, the Ollama server log (per-request `print_timing`, loads and evictions), `~/.openclaw/logs/orion-app.log`, and direct Ollama HTTP calls for benchmarks (about 12 short calls, nothing written to ORION state). No messages sent, no config changed.

## Short answer

The 9B is not slow. Idle, the same 9B answers a minimal prompt in 1.9 s at 35 tok/s. ORION makes it slow in four ways:

1. The Orion Mac app loads a third model (gpt-oss:20b, 13 GiB) at the start of the voice turns inspected. Ollama evicts the 4B and 9B to make room, and the worker call queues behind it. The same job also slows the voice reply.
2. The worker is given a 4-7k-token prompt and re-reads all of it every turn. Prefill runs at about 950 tok/s, so 1k tokens cost about 1 s. Replies are only 4-50 tokens, so decode is negligible.
3. In about 35% of turns, code has already written the exact reply and the 9B is called only to repeat it.
4. A volatile "Now: Fri 10:45" line at the top of the system prompt defeats KV reuse.

Sweeps hide all of this: models stay warm, there is no app, no session history, no TTS, no narrative job.

## Benchmark: same 9B, minimal prompt vs ORION's real worker prompt

Settings were the same as ORION's live settings: qwen3.5:9b, num_ctx 32768, think false, temperature 0.2, keep_alive 24h, models already resident (no load). "Real" is reconstructed from trajectory a280974a (the 10:45 real turn): system prompt, 4 provider-visible tools, 2-message history, and the user message with the app's SCHEDULING.md block. It came out at 6730 tokens against 6793 in the live call.

| Case | Prompt tokens | Prefill | Decode | Wall |
|---|---|---|---|---|
| Minimal ("You are a helpful assistant", 1 sentence) | 43 | 0.05-0.15 s | 64-69 tok at 35 tok/s = 1.9 s | 1.9-2.1 s |
| ORION real turn, 6.7k prompt (live: 9.1 s) | 6730 | 7.09 s (949 tok/s) | 48 tok, 1.35 s | 8.5 s |
| Same, identical repeat (KV hit) | 6730 | 0.05 s | 1.37 s | 1.4 s |
| Same, only the clock minute changed in the system prompt | 6730 | 7.25 s | 1.46 s | 8.8 s |
| First-turn shape (sys + tools + 11k-char block) | 4091 | 4.25 s | 0.6 s | 4.9 s |
| Same prompt, SCHEDULING.md block removed | 1189 | 1.23 s | 1.28 s | 2.6 s |
| Same, and no tool schemas | 309 | 0.40 s | 1.28 s | 1.7 s |
| Stable prefix (3.8k), new question at the end | 3847 | 1.09 s | 0.57 s | 1.7 s |
| Stable prefix (3.8k), only the Now minute changed | 3847 | 3.67 s | 0.56 s | 4.3 s |

Reading it: the model is the same in every row. The time is the prompt, not the model. Qwen3.5 is a hybrid (recurrent) model, so Ollama can only restore checkpoints; the stable-prefix test shows reuse is real but partial (3.7 s down to 1.1 s), and a changed first line removes all of it.

## Timeline of two instrumented real turns (both today)

Times are from the app log, gateway trace, Ollama GIN/print_timing lines and the trajectories. The Ollama and app logs are +01:00; trajectories are UTC.

### Turn 1: plain question, 10:36 (reply 15.4 s, then TTS 3 s)

| t (s) | Stage | Detail |
|---|---|---|
| -3.3 | App to gateway | Last Deepgram "heard" at 10:36:16, plugin hook at 10:36:19.3 (endpointing plus CLI spawn) |
| 0.0-2.5 | Front desk 4B | 2486-token prompt: prefill 1.45 s, 66 output tokens 1.0 s, total 2.47 s |
| +1.0 | Narrative job | App's gpt-oss:20b request reaches Ollama at 10:36:20.3 and evicts the idle 9B (and the 4B right after) |
| 2.5-4.3 | Gateway prep | Tool-search catalog and bootstrap, 1.8 s. orion-brain search (2.1 s, measured) ran in parallel with the front desk |
| 4.3-15.4 | Worker 9B call, 11.0 s | Waits for gpt-oss to load and generate (24 chars in 7.5 s), then reloads the 9B (about 2.5 s), prefill 4131 tokens 3.7 s, 14 output tokens 0.3 s. About 6.3 s is swap and queue |
| 15.4-18.4 | TTS | 57 chars, 3 s |

### Turn 2: "throw something small in before my class", 10:45 (reply 16.4 s, then TTS 15 s)

| t (s) | Stage | Detail |
|---|---|---|
| -2.7 | App to gateway | Last "heard" 10:45:09, hook 10:45:11.8 |
| 0.0-2.8 | Front desk 4B | 2.83 s (decision: "ask") |
| 2.8-4.4 | Gateway prep | 1.6 s |
| 4.4-6.7 | Schedule flow form call (9B) | 1369-token prefill 1.54 s, 24 output tokens 0.70 s, 2.29 s |
| 6.7-7.3 | `orion-reschedule add` plus calendar read | about 0.6 s |
| 7.3-16.4 | Worker 9B call, 9.1 s | 6793-token prompt: prefill 7.5 s (full re-processing), 48 output tokens 1.5 s. The 48 tokens are the verbatim text "Done: small task 5:50 PM..." that code had already built |
| 16.4-31.4 | TTS | 109 chars took 15 s (normal about 6.5 s). A gpt-oss narrative call ran on the GPU during playback: 16.4 s for 24 characters |

Why 6793 tokens: system 0.3k, 4 tool schemas about 0.9k, the 11k-char SCHEDULING.md block the app prepends (about 2.7k, matched because the message said "class"), plus the previous turn, which contains that block again in history (about 2.7k). So the block is paid twice.

### Aggregates (all turns since 10-15, shadow log)

| | Real chat (33) | Sweep (370) |
|---|---|---|
| Median turn | 15.6 s | 6.3 s |
| Front-desk decision | 2.8 s | 1.7 s |
| Everything after the decision | 12.3 s | 4.6 s |
| Revise passes > 0 | 4 of 33 | 50 of 370 (13.5%) |

Across all 421 turns since 10-15: 15% had at least one revise, median 10.2 s (1 pass) or 9.1 s (2 passes) vs 6.3 s with none, so a revise adds about 3-4 s. Turns with tool calls: median 9.5 s; without: 5.2 s. Turns where code already decided the reply (flow done/say, or a front-desk draft): 149 of 421 (35%), median 5.1 s.

## Answers to the five questions

**1. Which stage dominates?** The worker 9B call: 9.1 s of 16.4 s (55%) in turn 2, 11.0 s of 15.4 s (71%) in turn 1. Inside it, prefill dominates: 7.5 s prefill against 1.5 s decode. Decode is 14-48 tokens; median worker output is 38 tokens. Second is the front desk (2.5-2.8 s, about 17%) and fixed gateway prep (about 1.7 s, 11%). The 4B itself is cheap; its cost is a 2.4k-token system prompt plus a 7-field JSON output of 66-116 tokens.

**2. Are the 4B and 9B swapped in and out?** Yes, and not from config. Config is correct: num_ctx 32768 for the 9B and 16384 for the 4B match `ollama ps`, keep_alive is 24h, OLLAMA_MAX_LOADED_MODELS is 0 (auto). The cause is memory-based eviction. Ollama log, repeated: `llama-server model predicted to exceed available memory, evicting predicted="13.9 GiB" ... available="10.4 GiB" ... system_limited=true`. The Mac has 48 GiB, but Ollama sizes against free system memory (about 6-15 GiB while Chrome, Claude and ChatGPT are open), so a 13.9 GiB load evicts both resident models. Counts from server.log:

| Day | gpt-oss loads | 9B loads | 4B loads |
|---|---|---|---|
| 10-14 | 16 | 7 | 3 |
| 10-15 | 15 | 13 | 13 |
| 10-16 (to 12:44) | 15 | 13 | 19 |

The caller is the Orion app. The app log line `[narrative] brief-choice-v1...: 24 chars in 7507ms` matches Ollama's `POST /api/generate 7.506s` (and 16451 ms vs 16.436 s, 6664 ms vs 6.658 s). `LocalModel.swift` uses gpt-oss:20b via /api/generate, with no keep_alive and no num_ctx. `NarrativeWriter` and `DistractionReasoner` call it. It fires at mic press and refresh. I did not prove which of those two triggered each load; the timing is the evidence. The 9B reload costs about 2.5-3 s with a warm page cache; the 4B 1-2 s. Within-turn swap happened in turn 1. The 5-minute keepWarm reloads afterwards, so the next turn is usually warm again; the cost lands on the turn in flight and the one after.

Sweeps ran warm (no loads during 11:08-11:11), which is one reason they are faster.

**3. Is the prompt cache working?** Not across turns. Inputs: all 56 recent trajectory model.completed events show `cacheRead 0`. The Ollama log says `forcing full prompt re-processing` 43 times in the recent window, and a restore (`restored context checkpoint`) 417 times, but the restored checkpoint is only about 1.2-1.5k tokens (the 4B's stable system prompt, which does get reuse: 1017 of about 2.5k tokens re-evaluated). For the worker, the system prompt begins with job text, `Now: Fri 10:45 (Europe/London)`, brain snippets and notes that change every turn, so nothing after the first changed token can be reused. Benchmark confirms it: a one-minute clock change turns 0.05 s into 7.25 s.

Worker prompt size (usage.input): sweep median 2755 (p90 9700); real median 3818, range about 2.0k-6.8k (the 10-16 probe-plugin tool_search runs hit 13-15k). Parts: system 675-1210 chars (about 0.2-0.3k tokens), 4 tool schemas (about 0.9k), user message with the app prefix (outreach line 0.3k, SCHEDULING.md up to 12,000 chars = 2.7k when the message matches schedule|plan|class|nap|commute), and history. Session history: the persistent app session had 10 messages (8k chars) on 10-14 and 26 messages (17.9k chars, about 4.5k tokens) on 10-15; today's session was fresh (2 messages). Every history token is re-prefilled each turn.

**4. Is thinking on anywhere?** Not on the hot path. Trajectory `thinkLevel: "off"` for the ollama runs; every plugin Ollama call sends `think: false` (front desk, form fill, reminder extraction); openclaw.json sets `think: false`; worker output median is 38 tokens. The app's `[thinking] low for this turn` log is the Swift ThinkingPolicy label; `GatewayClient` passes `--thinking low` when no `ollama/` model is chosen, but the gateway ran off for these runs, so it is cosmetic for local routing. The exception is gpt-oss:20b, a reasoning model: about 200 generated tokens to write 24 characters (16.4 s at 10:45:36). That is the only thinking in the picture, and it is the app's, not the gateway's.

**5. How many sequential model calls does an everyday question make?** Minimum two: 4B front desk, then 9B worker (the sweep case; code reads the day and injects it, so no tool round trip). Three when a code flow needs the 9B (schedule form fill, reminder extraction; turn 2). Plus one full 9B call per revise (15% of turns). A turn where the worker uses a tool adds another round trip (turns with tools: 9.5 s vs 5.2 s). Alongside, the app may start a fourth, unrelated call (gpt-oss narrative) that blocks the same GPU. `orion-brain search` is a 2.1 s subprocess, mostly hidden behind the front desk.

## Other measured facts

- GPU throughput during live use is about half of idle. Median Ollama decode and prefill by day (9B and 4B mixed): 10-11 24 tok/s and 591; 10-13 26 and 458; 10-14 31 and 671; versus 10-16 57 and 944. On 10-14 the 9B decoded at 14-21 tok/s. Something shares the GPU in live use (candidates: the app's MLX TTS daemon, gpt-oss, other apps). Not isolated.
- Front-desk timeouts: two 8.0 s HTTP 500s on 10-15 at 23:02 and 23:03 (+01:00) while the log shows other 9B calls of 7-10k tokens interleaved. The front desk's 8 s abort turns into "escalate", so a slow 4B adds 8 s and loses its answer.
- TTS is not in `turnMs`: 12 spoken replies since 10-14 took a median 6.0 s for a median 80 chars (about 6 s per 100 chars); one 333-char reply took 32 s; the 109-char reply above took 15 s.
- End of speech to the plugin hook: 2.7-3.3 s (not in `turnMs`).
- Not a cause: contextPruning, memory search, localModelLean (system prompt is already lean: 0.7-1.3k chars), num_ctx mismatch, keep_alive.
- Out of scope: the `orion-probe-plugin` runs with 2008-2048 output tokens are tool_search "reply with the raw result" tests (hit num_predict 2048, 49-59 s). Not representative of real chat.

## Root causes ranked by seconds saved (per affected real turn)

| # | Cause | Seconds | Evidence |
|---|---|---|---|
| 1 | App fires gpt-oss:20b (13 GiB) around each voice turn; Ollama evicts 4B and 9B, the worker queues and reloads, TTS shares the GPU | 6-9 s on affected turns (turn 1: about 6.3 s in-call; turn 2: TTS 15 s vs 6.5 s) | 15 loads today; both inspected real turns |
| 2 | Worker called to repeat code-written text with the full prompt | up to 6.8 s (8.5 s to 1.7 s); 35% of turns | Turn 2; benchmark rows 2 and 7 |
| 3 | App prepends SCHEDULING.md (up to 12k chars) to the message and it is also kept in history | about 6.0 s on turns that match the regex (7.25 s to 1.23 s); 2 of 33 real turns, 7% of sweep | Benchmark rows 2 and 6 |
| 4 | No KV reuse: clock and brain snippets at the top of the system prompt; history re-prefilled | about 2.6 s on a 3.8k prompt (3.67 to 1.09 s) | Benchmark rows 8-9 |
| 5 | Persistent session history (up to 26 messages) | 1-4 s | hist chars 17.9k on 10-15 |
| 6 | Tool schemas sent on turns that cannot use tools | about 0.9 s | 1189 vs 309 tokens |
| 7 | Front desk: 2.4k prompt plus 7-field JSON; 8 s abort on contention | 0.7-1.0 s (and avoids the 8 s timeouts) | 66-116 output tokens |
| 8 | Revise passes | 3-4 s on 15% of turns (0.6 s average) | shadow log |
| 9 | Gateway prep (tool-search catalog of 33 tools, bootstrap) | up to 1.7 s; in openclaw, not this plugin | 1.6-1.8 s gaps |

Rows 1-3 are the difference between 15.6 s and the sweep's 6 s. Treat these as estimates from two instrumented turns and one benchmark; they overlap (fixing 2 and 3 together does not save the sum).

## Fixes and expected savings

1. Stop the third model from evicting the first two (app, `LocalModel.swift`, `ModelContract` role "local"). Options, in order of preference: (a) point the narrative/distraction role at qwen3.5:9b, which is already resident; (b) if gpt-oss must stay, generate narratives only when Nick has been idle for a few minutes, never at mic press, and call keepWarm straight after. Expected: removes 6-9 s from affected turns and the 15 s TTS case. Correctness risk: HIGH for (a). The comment in LocalModel.swift records that a 3B inverted a health summary and gpt-oss got it right; the 9B is untested for the health and brief narratives. Re-run the narrative checks before switching. (b) has no model-quality risk but delays narratives.
2. Never send the full prompt for a fixed reply (flow done/say, front-desk draft). The host's direct-reply hook does not fire on the agent CLI route (found live 10-11), so do not rely on `handled: true`. Instead, for these turns return a minimal system prompt with no tools and no history (benchmark: 1.7 s vs 8.5 s). Expected: 5-7 s on 35% of turns. Risk: low, since the reply is already dictated and `putReplyInPlace` plus the finalize check still run. Watch that the finalize check does not need tool results from history.
3. Stop prepending SCHEDULING.md to the user message for local routing, or cap it at 1.5k chars. The plugin already supplies SCHEDULING_INSTRUCTIONS for scheduling jobs. Also keep the outreach line short. Expected: about 6 s on matching turns, and history stays small. Risk: medium. The 9B may lose personal scheduling preferences (commute, minimum durations). Check with the scheduling eval first. Keeping the rules but only in the system prompt (stable, cacheable) is the safer variant.
4. Make the worker prefix stable: system prompt = fixed instructions and tools only; move `Now:`, brain snippets, flow notes and per-turn notes to the end of the user message. Expected: 2-3 s per turn on 3-4k prompts (partial reuse; the hybrid model caps the gain). Risk: low to medium. The model must still read the clock; verify the time-question evals.
5. Cap session history for local routing (last 4 messages, drop tool output and any injected block). Expected: 1-4 s on long sessions. Risk: medium for follow-ups ("and after that?"). The plugin already keeps dayMemory and pending-add state in code, which covers the main cases.
6. Send no tool schemas when `noTools`, `provided`, `flow` or `codeRead` is set. Expected: about 0.9 s on those turns. Risk: low.
7. Front desk: make the output schema smaller (drop `think`, `tier`, `say`, `args` unless needed) and shorten the 10 KB system prompt. Expected: 0.7-1.0 s. Risk: HIGH for correctness. The prompt and schema are frozen at 123/138 on the held-out set; any change needs the V3 eval re-run. Alternatively raise the 8 s abort only under contention instead of silently escalating.
8. Single-call design for simple turns: if the front desk says answer/ask/tool and code has the data, answer from code and skip the worker entirely (about 1.7-2 s total instead of 5-6 s). Risk: HIGH. This relies on the direct-reply path that does not fire on the CLI route, and removes the model's check on draft facts (the 10-15 "you've been coding for hours" case). Do 2 first and measure.
9. Fewer revise passes: only revise on claims about writes; a lookup claim can use the fixed honest line without another 9B call (3-4 s on 15% of turns, about 0.6 s average). Risk: medium, it changes honesty behaviour that has sweep coverage.
10. Keep both models resident: already done (24h, matching num_ctx). OLLAMA_MAX_LOADED_MODELS and keep_alive do not fix memory-based eviction. Freeing memory (fewer big apps) only helps indirectly. Do not rely on this alone.
11. Voice side (outside this plugin): shorten spoken replies (about 6 s per 100 chars), and don't run any LLM during TTS playback.

Suggested order: 1, 2, 3, 6 (low-risk, about 10 s on the bad turns), then 4, 5, then re-evaluate 7-9.

Expected result: a real turn like turn 2 goes from 16.4 s to roughly 7 s (front desk 2.8 + gateway 1.7 + minimal worker 1.7 + form fill about 1.0), and turn 1 from 15.4 s to about 6.5 s (no queue or reload). Sweep turns improve less (2.5-3.0 s).

## Not verified

- Which app call fired gpt-oss at each instant (NarrativeWriter vs DistractionReasoner); the log lines match by duration, not by trace id.
- The cause of the half-speed GPU on live-use days.
- App-to-gateway latency beyond endpointing (no timestamp from the Swift side).
- Only 2 real turns have a complete log set; the other 31 are from the shadow log and the Ollama log.
- Benchmark tool schemas were rebuilt from a depth-truncated trajectory, so schemas are approximate (token count within 1%).
