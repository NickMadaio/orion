// Watchdog constants. Contexts and keep_alive mirror scripts/lib/local-model.mjs and the front desk: a different
// num_ctx reloads a resident model, so the warm-up must ask for exactly these.
export const OLLAMA_URL = "http://127.0.0.1:11434";
export const GATEWAY_URL = "http://127.0.0.1:18789/health";
export const COMPONENTS = ["ollama", "app", "link", "gateway"];

export const WARM_MODELS = Object.freeze([
  Object.freeze({ model: "qwen3.5:4b-q4_K_M", num_ctx: 16384 }),
  Object.freeze({ model: "qwen3.5:9b", num_ctx: 32768 }),
]);
export const KEEP_ALIVE = "24h";

export const BACKOFF_BASE_MS = 60_000;
export const BACKOFF_MAX_MS = 15 * 60_000;
export const ALERT_MIN_GAP_MS = 10 * 60_000;
export const PROBE_TIMEOUT_MS = 4_000;
export const WARM_TIMEOUT_MS = 180_000;

/**
 * What the watchdog may do for each component. The gateway is deliberately absent: it is KeepAlive under launchd and
 * a restart would cut a running focus session. It is watched and alerted on, never acted on.
 */
export const RELAUNCH = Object.freeze({
  ollama: Object.freeze({ cmd: "/usr/bin/open", args: ["-g", "-a", "Ollama"] }),
  app: Object.freeze({ cmd: "/usr/bin/open", args: ["-a", "Orion"] }),
  link: Object.freeze({ cmd: "/bin/launchctl", args: ["kickstart", "gui/{uid}/com.nickmadaio.orion.link"] }),
});
