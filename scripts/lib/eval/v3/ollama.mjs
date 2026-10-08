// A streaming Ollama /api/chat client for the V3 evaluation (handoff §13.1).
// Streaming is the point: Nick's speed rule is about how soon ORION starts
// answering, so every call records the time to the first token of any kind and
// to the first answer token (content or a tool call), next to Ollama's own load,
// prompt-read and generation timings. A step can stop on a wall-clock timeout or
// when thinking passes a cap (the Qwen3.5-2B card warns of thinking loops).
// Errors come back as data so one bad step never kills a whole run.
// (Written by Claude on 2026-10-08 for the V3 local-first evaluation.)

export const OLLAMA = process.env.OLLAMA_HOST ? `http://${process.env.OLLAMA_HOST.replace(/^https?:\/\//, "")}` : "http://127.0.0.1:11434";
const NS = 1e6;

const emptyResult = (start) => ({
  message: { role: "assistant", content: "", thinking: "", tool_calls: [] },
  timings: { firstTokenMs: null, ttftMs: null, wallMs: null, loadMs: null, promptN: null, promptMs: null, evalN: null, evalMs: null },
  doneReason: null, aborted: null, error: null, startedAt: start,
});

const absorb = (r, chunk, elapsed) => {
  const m = chunk.message ?? {};
  const answered = Boolean(m.content) || Boolean(m.tool_calls?.length);
  const first = r.timings.firstTokenMs ?? (answered || m.thinking ? elapsed : null);
  const next = {
    ...r,
    message: {
      ...r.message,
      content: r.message.content + (m.content ?? ""),
      thinking: r.message.thinking + (m.thinking ?? ""),
      tool_calls: [...r.message.tool_calls, ...(m.tool_calls ?? [])],
    },
    timings: { ...r.timings, firstTokenMs: first, ttftMs: r.timings.ttftMs ?? (answered ? elapsed : null) },
  };
  if (!chunk.done) return next;
  return {
    ...next,
    doneReason: chunk.done_reason ?? "stop",
    timings: {
      ...next.timings,
      loadMs: (chunk.load_duration ?? 0) / NS, promptN: chunk.prompt_eval_count ?? 0, promptMs: (chunk.prompt_eval_duration ?? 0) / NS,
      evalN: chunk.eval_count ?? 0, evalMs: (chunk.eval_duration ?? 0) / NS,
    },
  };
};

/**
 * One chat step. Returns { message: { content, thinking, tool_calls }, timings, doneReason, aborted, error }.
 * aborted: "timeout" | "think-cap" | null. think: false | true | "low" | "medium" | "high" | undefined.
 */
export async function chat({ model, messages, tools, format, think, options = {}, keepAlive = "30m", timeoutMs = 60000, thinkCap = null, fetchImpl = fetch, now = () => performance.now() }) {
  const start = now();
  const controller = new AbortController();
  let reason = null;
  const stop = (why) => { if (!reason) { reason = why; controller.abort(); } };
  const timer = setTimeout(() => stop("timeout"), timeoutMs);
  const body = { model, messages, stream: true, options, keep_alive: keepAlive, ...(tools?.length ? { tools } : {}), ...(format ? { format } : {}), ...(think === undefined ? {} : { think }) };
  let r = emptyResult(start);
  try {
    const res = await fetchImpl(`${OLLAMA}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: controller.signal });
    if (!res.ok) return { ...r, error: `HTTP ${res.status}: ${(await res.text?.()) ?? ""}`.slice(0, 500) };
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split("\n");
      buf = lines.pop();
      for (const line of lines.filter((l) => l.trim())) {
        const chunk = JSON.parse(line);
        if (chunk.error) return { ...r, error: String(chunk.error).slice(0, 500), timings: { ...r.timings, wallMs: now() - start } };
        r = absorb(r, chunk, now() - start);
        if (thinkCap && r.message.thinking.length >= thinkCap) stop("think-cap");
      }
      if (reason) break;
    }
  } catch (error) {
    if (!reason) return { ...r, error: String(error?.message ?? error).slice(0, 500), timings: { ...r.timings, wallMs: now() - start } };
  } finally {
    clearTimeout(timer);
  }
  return { ...r, aborted: reason, timings: { ...r.timings, wallMs: now() - start } };
}

/** Model facts for the ledger: digest, quantization, thinking values. */
export async function modelInfo(model, fetchImpl = fetch) {
  try {
    const show = await (await fetchImpl(`${OLLAMA}/api/show`, { method: "POST", body: JSON.stringify({ model }) })).json();
    const tags = await (await fetchImpl(`${OLLAMA}/api/tags`)).json();
    const tag = tags.models?.find((m) => m.name === model || m.model === model);
    return { model, digest: tag?.digest ?? null, quantization: show.details?.quantization_level ?? null, thinking: show.thinking ?? null, parameterSize: show.details?.parameter_size ?? null };
  } catch (error) {
    return { model, error: String(error?.message ?? error) };
  }
}
