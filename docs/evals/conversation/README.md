# Conversation model comparison

Prepare now; run later. No routing defaults are changed by this harness.

Use `node scripts/orion-conversation-bench --dry-run` to inspect candidates and call count. Default candidates are Llama 3.2 3B, Qwen 3.5 9B and Qwen 3.6 27B. Hosted Haiku 4.5 and Sonnet 5 require explicit `--model` selection and `ANTHROPIC_API_KEY` in the process environment. Never paste keys into commands, results, or Git.

Example local run:

```
node scripts/orion-conversation-bench --run --model llama3.2:3b --repeats 5 --seed 42 --out /private/path/llama-short.json
```

Repeat with `--long`, then each candidate with the same seed and repetition count. Results are saved after each call so interruptions preserve completed trials. Calls are serial with a 180-second timeout. No calendar, reminder, email or other tool executes. Hosted requests incur provider charges and bypass gateway usage logs; keep their usage separate when accounting.

The suite contains arithmetic, clock arithmetic, format compliance, multi-turn recall, corrections, unknown personal facts, casual conversation, clarification, positive tool intent and negative tool intent. Extend the fixtures with anonymized real conversations before the full comparison. Each fixture has a reference route and objective assertions or a human rubric. An automated pass on a human-review case proves only JSON/route validity, not answer quality.

## Full test protocol

1. Freeze model versions/quantizations, Ollama version, hardware/RAM, context size, temperature, output cap, thinking mode, system prompt and background load. Record them alongside results. Compare thinking modes as separate candidates, not silently mixed results.
2. Use at least five repetitions per case and both short/long contexts. Seeded order interleaves cases/models. Run cold-load and warm batches separately: the first-call marker is not proof of a cold model. Ollama load duration is captured, but a cold experiment requires deliberate unload before starting a batch.
3. Report median and p95 total response latency, failure/timeout rate, prompt tokens, output tokens, load duration and generation tokens/second. This non-streaming foundation does not measure time to first token; add a streaming adapter before drawing conclusions about perceived responsiveness. Do not silently replace that metric with total latency.
4. Blind the model labels for human review. Score correctness, instruction following, memory consistency, uncertainty, naturalness and concision 0–4 with written anchors. Score tool requests separately: escalation recall, unnecessary escalation rate, fabricated-action rate. Review all assertions against full answers; string matches alone cannot establish accuracy.
5. Add a representative held-out set of at least 50 ordinary chats and 25 tool-intent/no-tool contrasts, including scheduling with to-dos, 5-minute transitions, 45-minute commute, food en route, nap minimums and conflicting commitments. Keep calibration and held-out cases distinct. Personal source transcripts stay outside Git.
6. Select the smallest local model only if it meets the agreed quality threshold and response-time target. Never execute its proposed tool actions directly. Escalation goes to a tool-capable model with the original conversation and authoritative state; only verified tool results can claim completion.
7. Validate the chosen route in ORION through the real gateway as a second phase. Direct API/Ollama scores do not prove gateway latency, context/memory loading, tool selection or escalation reliability. Keep task/scheduling benchmarks separate from normal conversation results.

The checked-in 12-case suite is a calibration scaffold, not a thorough benchmark result. No inference runs were performed while setting it up.
