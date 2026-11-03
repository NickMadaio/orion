// Unload ORION's idle Ollama models to free memory for a game (w18 gamemode). The 4b front-desk model stays loaded: every chat turn needs it.
// Ollama unloads a model when it gets keep_alive 0 on /api/generate. Everything goes through an injected fetch, so tests need no server.
const FRONT_DESK = /(?:^|[:\-_ ])4b(?:$|[:\-_ ])/i;
const DEFAULT_HOST = () => (process.env.OLLAMA_HOST ? (/^https?:/.test(process.env.OLLAMA_HOST) ? process.env.OLLAMA_HOST : `http://${process.env.OLLAMA_HOST}`) : "http://127.0.0.1:11434");

/** { unloaded: [{ name, size }], freedBytes }. A server that is not running is not an error: nothing is loaded, nothing is freed. */
export async function unloadIdleModels({ fetch: doFetch = globalThis.fetch, host = DEFAULT_HOST(), dryRun = false } = {}) {
  const none = { unloaded: [], freedBytes: 0 };
  let loaded;
  try {
    const res = await doFetch(`${host}/api/ps`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return none;
    loaded = (await res.json()).models ?? [];
  } catch { return none; }
  const idle = loaded.filter((m) => m?.name && !FRONT_DESK.test(m.name));
  const unloaded = [];
  for (const m of idle) {
    if (!dryRun) {
      try {
        const res = await doFetch(`${host}/api/generate`, { method: "POST", headers: { "content-type": "application/json" },
          body: JSON.stringify({ model: m.name, keep_alive: 0 }), signal: AbortSignal.timeout(8000) });
        if (!res.ok) continue;
      } catch { continue; }
    }
    unloaded.push({ name: m.name, size: Number(m.size) || 0 });
  }
  return { unloaded, freedBytes: unloaded.reduce((n, m) => n + m.size, 0) };
}
