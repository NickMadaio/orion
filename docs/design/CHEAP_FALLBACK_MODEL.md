# Cheap fallback model for ORION (2026-10-16)

Status: **recommendation made, measurement pending** — no API key exists yet (Nick must create it), so
step 3 (day question bank graded by Haiku against the local 9B) has not run. The numbers below are
published prices; the speed/correctness/cost-per-turn columns are blank until the eval runs.

## Goal

ORION must never go silent when local routing is off (no acceptance record or testing window)
or Ollama is down. Today the configured primary is `anthropic/claude-haiku-4-5-20251001`, whose account
has no credit, and the fallbacks are the local 9B and llama3.2:3b with the full 17k-token workspace
prompt (60-300 s, timeouts). Nick: avoid cloud Claude unless necessary; a very cheap model is fine.

## Shortlist (prices per 1M tokens, checked 2026-10-16 against vendor pages)

| Model (OpenClaw ref) | Input (miss / cache hit) | Output | Tools | OpenClaw provider | Data policy |
|---|---|---|---|---|---|
| **DeepSeek V4.1 Flash** (`deepseek/deepseek-v4-flash`; API name `deepseek-flash`) | $0.15 / $0.003 off-peak, x2 peak (01-04 and 06-10 UTC weekdays) | $0.60 off-peak, $1.20 peak | yes, 1M ctx | `deepseek`, official plugin `@openclaw/deepseek-provider` (not installed yet), `DEEPSEEK_API_KEY` | China-hosted; vendor page gives no retention terms. Calendar/health data would leave the Mac. |
| **Gemini 2.5 Flash-Lite** (`google/gemini-2.5-flash-lite`) | $0.10 | $0.40 | yes | `google`, bundled but **disabled**; `GEMINI_API_KEY` | Paid tier: not used to improve products. Free tier IS used for training, so billing must be on. |
| **GPT-5 nano** (`openai/gpt-5-nano`) | $0.05 / $0.005 | $0.40 | yes | `openai`, bundled, not enabled | Standard API terms (no training by default). |
| Mistral Small (`mistral/...`) | not confirmable from the vendor page | | likely | `mistral`, bundled | EU-hosted |

Latency from London was not measured (needs a key). Expect Gemini and OpenAI to be fastest from the UK;
DeepSeek routes to China and is the likeliest to be slow or flaky, and its peak window overlaps Nick's
mornings. Per-turn cost, assuming the slim ~3k-token local-route prompt plus ~300 output tokens, is
roughly $0.0005-$0.001 for all of them, so price is not the deciding factor; privacy and latency are.

## Recommendation

**Primary candidate: Gemini 2.5 Flash-Lite** (cheapest-class, Western hosting, paid-tier no-training,
fast from London). **DeepSeek V4.1 Flash is the alternative** if Nick wants the cheapest cache-hit
pricing and accepts China-hosted processing of his schedule data. Run the eval on both, then confirm.
This is a pre-measurement recommendation and should be revised if the eval says otherwise.

### Why the config is not just "reorder fallbacks"

With `localRouting: "on"` the plugin sends every turn to `ollama/qwen3.5:9b` itself. The configured
primary only answers when routing is off (window lapsed, acceptance missing) — that is exactly when
ORION went silent. So the cheap model should be the **primary**, the local 9B the fallback, and Claude
removed. Local-first behaviour while routing is on is unchanged. (The 9B as primary would make
routing-off turns run the 17k workspace prompt on it, the 60-300 s case.)

### Exact `~/.openclaw/openclaw.json` change (Gemini variant)

```diff
 "agents": { "defaults": {
   "model": {
-    "primary": "anthropic/claude-haiku-4-5-20251001",
-    "fallbacks": ["ollama/qwen3.5:9b", "ollama/llama3.2:3b"]
+    "primary": "google/gemini-2.5-flash-lite",
+    "fallbacks": ["ollama/qwen3.5:9b", "ollama/llama3.2:3b"]
   },
   "models": {
+    "google/gemini-2.5-flash-lite": {},
     "ollama/qwen3.5:9b": {},
     "anthropic/claude-haiku-4-5-20251001": { "params": { "cacheRetention": "long" } }
```
plus enabling the plugin (`plugins.allow` += `"google"`, `plugins.entries.google.enabled: true`).
DeepSeek variant: `deepseek/deepseek-v4-flash`, `plugins.allow` += `"deepseek"` after
`openclaw plugins install @openclaw/deepseek-provider`. Keep the `anthropic` entries so Claude can be
re-added to the end of `fallbacks` once the account has credit. Back up first (`~/.openclaw/backups/`),
then `openclaw gateway restart`.

## What Nick must do (I did not, and will not, create accounts or keys)

1. Create a key: Gemini at aistudio.google.com/apikey (**turn on billing** for the project so the paid,
   no-training terms apply; set a small budget alert) — or DeepSeek at platform.deepseek.com/api_keys
   with a $5 top-up.
2. Store it in Keychain like the other keys (so it is not in a file):
   `security add-generic-password -s "ORION OpenClaw Gemini" -a openclaw -w` (prompts for the key), and
   tell me; I add a matching `secrets.providers` entry and the `apiKey` ref, as for Anthropic.
3. Say "go" and I will: enable the plugin, run `questions-day.json` (71 read-only items) through a test
   session with that model as the only configured model, grade with Haiku against the local 9B on
   correctness, tool use, median/p95 time and cost per turn, and then fill in the table below and
   apply the config change.

## Measurements (to fill in once a key exists)

| Model | Pass % | Tool-use correct % | Median s | p95 s | Cost / turn |
|---|---|---|---|---|---|
| local qwen3.5:9b (baseline) | | | | | $0 |
| gemini-2.5-flash-lite | | | | | |
| deepseek-v4-flash | | | | | |
