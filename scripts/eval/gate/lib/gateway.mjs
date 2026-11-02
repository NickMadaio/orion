// One `openclaw agent` call exactly as GatewayClient.ask makes it, and what to read back afterwards:
// the tool calls from the session transcript and the routing line(s) from the local-routing log.
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { run, secret } from "./live.mjs";
import { findPayload, extractReply } from "./reply.mjs";

export const AGENT_TIMEOUT_S = 300;           // RunTimeouts.agentTimeout
const KILL_AFTER_MS = (AGENT_TIMEOUT_S + 20 + 5) * 1000;   // terminateAt + killGrace

/** GatewayClient.ask's environment: PATH extended the same way, GOG_KEYRING_PASSWORD passed through. */
export function agentEnv(p, base = process.env) {
  const required = "/usr/bin:/bin:/usr/sbin:/sbin:/Users/nickmadaio/.openclaw/bin";
  const env = { ...base, PATH: base.PATH ? `${base.PATH}:${required}` : required };
  const gog = secret("GOG_KEYRING_PASSWORD", p);
  if (gog) env.GOG_KEYRING_PASSWORD = gog;
  return env;
}

/** The argv GatewayClient.ask passes to the CLI, in the same order. */
export function agentArgs({ key, message, thinking, model = null }) {
  return ["agent", "--session-key", key, "--message", message, "--json", "--timeout", String(AGENT_TIMEOUT_S),
    ...(model ? ["--model", model] : []), "--thinking", thinking];
}

const sizeOf = (f) => { try { return statSync(f).size; } catch { return 0; } };

/** The session transcript for a key (sessions.json index, same lookup as ChatThinking.transcript). */
export function transcriptFile(p, key) {
  try {
    const index = JSON.parse(readFileSync(join(p.sessions, "sessions.json"), "utf8"));
    return index[`agent:main:${key}`.toLowerCase()]?.sessionFile ?? null;
  } catch { return null; }
}

import { computerSteps } from "./computer-evidence.mjs";

export function toolCalls(file, sinceMs) {
  if (!file || !existsSync(file)) return [];
  const calls = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    const m = e.message; if (!m || Date.parse(e.timestamp) < sinceMs) continue;
    if (m.role === "assistant" && Array.isArray(m.content)) {
      for (const c of m.content) if (c.type === "toolCall" || c.type === "tool_use") calls.push({ tool: c.name, args: JSON.stringify(c.arguments ?? c.input ?? {}).slice(0, 600) });
    }
    if (m.role === "toolResult" || m.role === "tool") {
      const text = Array.isArray(m.content) ? m.content.map((c) => c.text ?? "").join(" ") : String(m.content ?? "");
      const last = [...calls].reverse().find((c) => c.result === undefined);
      if (last) { last.result = text.slice(0, 500); if (m.isError) last.isError = true; }
    }
  }
  return calls;
}

/** Every routing-log line for this run, plus one merged summary (later lines win, null never overwrites). */
export function routingFor(p, offset, runId, messageText) {
  const raw = existsSync(p.shadow) ? readFileSync(p.shadow).subarray(offset).toString("utf8") : "";
  const lines = raw.split("\n").filter(Boolean).map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  const mine = runId ? lines.filter((l) => l.runId === runId) : lines.filter((l) => typeof l.message === "string" && messageText.includes(l.message));
  if (!mine.length) return null;
  const summary = {};
  for (const l of mine) for (const [k, v] of Object.entries(l)) if (v !== null && v !== undefined && k !== "stage") summary[k] = v;
  return { runId: mine[0].runId ?? null, lines: mine.length, summary, stages: mine.map((l) => l.stage ?? "turn") };
}

/** Spawns the real CLI. Never throws: a failed turn is a result with `error` set, as it is in the app. */
export async function runTurn({ p, key, message, thinking, model = null, env }) {
  const started = Date.now();
  const offset = sizeOf(p.shadow);
  const r = await run(p.openclaw, agentArgs({ key, message, thinking, model }), { timeoutMs: KILL_AFTER_MS, env: env ?? agentEnv(p) });
  const latencyMs = Date.now() - started;
  const { payload, stdout } = findPayload(r.stdout);
  const reply = payload ? extractReply(payload) : stdout;
  const meta = payload?.result?.meta ?? {};
  const file = meta.agentMeta?.sessionFile ?? transcriptFile(p, key);
  return {
    reply, latencyMs, status: payload?.status ?? (r.timedOut ? "timeout" : r.error ?? `exit ${r.status}`),
    error: reply ? undefined : (r.stdout + r.stderr).slice(-800),
    model: meta.agentMeta?.model ?? null, usage: meta.agentMeta?.usage ?? null,
    tools: [...toolCalls(file, started), ...computerSteps(p, started, key)], routing: routingFor(p, offset, payload?.runId, message),
    startedAt: started, sessionFile: file, raw: payload ?? stdout,
  };
}
