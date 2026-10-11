/*
 The front desk: one small local model reads every message and picks ONE move.

   answer / ask  — it replies itself (chit-chat, the time, a needed question)
   ignore        — the speech was not for ORION
   tool          — exactly one tool does the whole job
   escalate      — anything bigger goes to the worker model

 Measured in the V3 evaluation (docs/evals/v3/REPORT.md §9): qwen3.5:4b with the frozen prompt in
 front-desk-prompt.ts scored 123/138 on held-out real and synthetic messages, ~0.5 s to the first
 token when warm. The request is built exactly as the evaluation built it (stable system prompt
 first, then one user message with the clock, recent turns and Nick's message last).

 It must never block a turn: any timeout, HTTP error, unparsable or invalid output becomes
 "escalate" with a `fallback` reason, i.e. the worker handles the message as it would without a
 front desk. (Written by Claude on 2026-10-10 for the V3 implementation.)
*/
import { FRONT_DESK_MODEL, FRONT_DESK_SYSTEM, FRONT_DESK_TEMPERATURE } from "./front-desk-prompt.js";

export const MOVES = ["answer", "tool", "escalate", "ask", "ignore"] as const;
export type Move = (typeof MOVES)[number];
export const MENU_TOOLS = ["weather", "lights", "alarm", "wake", "session", "phone_time", "agenda", "tasks", "reschedule", "show", "app_open", "browser", "media", "log_intake", "supplements", "brain", "repair_note"] as const;

export type Decision = {
  move: Move;
  tool?: string;
  args?: Record<string, unknown>;
  tier?: "quick" | "standard" | "deep";
  say?: string;
  answer?: string;
  fallback?: string;
  ms?: number;
};

type Turn = { role: "user" | "assistant"; content: string };
export type FrontDeskInput = { message: string; clock: string; history?: Turn[] };

const SCHEMA = {
  type: "object",
  properties: {
    move: { type: "string", enum: [...MOVES] },
    tool: { type: "string" },
    args: { type: "object" },
    tier: { type: "string", enum: ["quick", "standard", "deep"] },
    think: { type: "string", enum: ["off", "low", "high"] },
    say: { type: "string" },
    answer: { type: "string" },
  },
  required: ["move", "tool", "args", "tier", "think", "say", "answer"],
};

/** The Ollama /api/chat body, identical in shape to the evaluation's front-desk call. */
export function frontDeskRequest({ message, clock, history = [] }: FrontDeskInput, model = FRONT_DESK_MODEL) {
  const earlier = history.slice(-8).map((m) => `${m.role === "assistant" ? "ORION" : "Nick"}: ${m.content}`).join("\n");
  const content = [`Now: ${clock}.`, earlier ? `Earlier:\n${earlier}` : null, `Message:\nNick: ${message}`].filter(Boolean).join("\n\n");
  return {
    model,
    stream: false,
    think: false,
    format: SCHEMA,
    options: { temperature: FRONT_DESK_TEMPERATURE, num_ctx: 16384 },
    keep_alive: "24h",
    messages: [{ role: "system", content: FRONT_DESK_SYSTEM }, { role: "user", content }],
  };
}

const fallback = (reason: string, started: number): Decision => ({ move: "escalate", fallback: reason, ms: Date.now() - started });

/** Ask the front desk for a move. Never throws; anything unexpected escalates to the worker. */
export async function decide(input: FrontDeskInput, { fetchImpl = fetch, baseUrl = "http://127.0.0.1:11434", timeoutMs = 8000, model = FRONT_DESK_MODEL }: {
  fetchImpl?: typeof fetch; baseUrl?: string; timeoutMs?: number; model?: string;
} = {}): Promise<Decision> {
  const started = Date.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${baseUrl}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(frontDeskRequest(input, model)), signal: controller.signal });
    if (!res.ok) return fallback(`http ${res.status}`, started);
    const body = (await res.json()) as { message?: { content?: string } };
    let out: Record<string, unknown>;
    try { out = JSON.parse(body.message?.content ?? ""); } catch { return fallback("unparsable output", started); }
    const move = out.move as Move;
    if (!MOVES.includes(move)) return fallback("invalid move", started);
    if (move === "tool" && !MENU_TOOLS.includes(out.tool as (typeof MENU_TOOLS)[number])) return fallback("unknown tool", started);
    if ((move === "answer" || move === "ask") && !String(out.answer ?? "").trim()) return fallback("empty answer", started);
    return {
      move,
      ...(move === "tool" ? { tool: String(out.tool), args: (out.args as Record<string, unknown>) ?? {} } : {}),
      ...(move === "escalate" ? { tier: (out.tier as Decision["tier"]) ?? "standard" } : {}),
      ...(String(out.say ?? "").trim() ? { say: String(out.say) } : {}),
      ...(String(out.answer ?? "").trim() ? { answer: String(out.answer) } : {}),
      ms: Date.now() - started,
    };
  } catch (error) {
    return fallback(controller.signal.aborted ? "timeout" : `error: ${error instanceof Error ? error.message : String(error)}`, started);
  } finally {
    clearTimeout(timer);
  }
}

/** Load the front desk into memory (and keep it there) so the first message is not a cold start. Never throws. */
export async function warmUp({ fetchImpl = fetch, baseUrl = "http://127.0.0.1:11434", model = FRONT_DESK_MODEL }: { fetchImpl?: typeof fetch; baseUrl?: string; model?: string } = {}): Promise<boolean> {
  try {
    const res = await fetchImpl(`${baseUrl}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, keep_alive: "24h" }) });
    return res.ok;
  } catch { return false; }
}
