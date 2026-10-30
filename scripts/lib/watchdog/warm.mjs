import { KEEP_ALIVE, OLLAMA_URL, WARM_MODELS, WARM_TIMEOUT_MS } from "./config.mjs";

/** Request body that loads a model at an exact context and pins it for 24h. An empty prompt generates nothing. */
export const warmBody = ({ model, num_ctx }) => ({
  model, prompt: "", stream: false, think: false, keep_alive: KEEP_ALIVE, options: { num_ctx },
});

/** Warm sequentially (two loads at once fight for memory). Returns [{model, ok, error?}]. */
export async function warmAll(fetchImpl, models = WARM_MODELS) {
  const results = [];
  for (const m of models) {
    try {
      const res = await fetchImpl(`${OLLAMA_URL}/api/generate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(warmBody(m)),
        signal: AbortSignal.timeout(WARM_TIMEOUT_MS),
      });
      results.push(res.ok ? { model: m.model, ok: true } : { model: m.model, ok: false, error: `HTTP ${res.status}` });
    } catch (error) {
      results.push({ model: m.model, ok: false, error: String(error?.message ?? error).slice(0, 120) });
    }
  }
  return results;
}
