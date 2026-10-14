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
/** One context size for every call and the warm-up: a different num_ctx makes Ollama reload the model. */
export const FRONT_DESK_CTX = 16384;
export const MOVES = ["answer", "tool", "escalate", "ask", "ignore"];
export const MENU_TOOLS = ["weather", "lights", "alarm", "wake", "session", "phone_time", "agenda", "tasks", "reschedule", "show", "app_open", "browser", "media", "log_intake", "supplements", "brain", "repair_note"];
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
export function frontDeskRequest({ message, clock, history = [] }, model = FRONT_DESK_MODEL) {
    const earlier = history.slice(-8).map((m) => `${m.role === "assistant" ? "ORION" : "Nick"}: ${m.content}`).join("\n");
    const content = [`Now: ${clock}.`, earlier ? `Earlier:\n${earlier}` : null, `Message:\nNick: ${message}`].filter(Boolean).join("\n\n");
    return {
        model,
        stream: false,
        think: false,
        format: SCHEMA,
        options: { temperature: FRONT_DESK_TEMPERATURE, num_ctx: FRONT_DESK_CTX },
        keep_alive: "24h",
        messages: [{ role: "system", content: FRONT_DESK_SYSTEM }, { role: "user", content }],
    };
}
const fallback = (reason, started) => ({ move: "escalate", fallback: reason, ms: Date.now() - started });
/** Ask the front desk for a move. Never throws; anything unexpected escalates to the worker. */
export async function decide(input, { fetchImpl = fetch, baseUrl = "http://127.0.0.1:11434", timeoutMs = 8000, model = FRONT_DESK_MODEL } = {}) {
    const started = Date.now();
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchImpl(`${baseUrl}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(frontDeskRequest(input, model)), signal: controller.signal });
        if (!res.ok)
            return fallback(`http ${res.status}`, started);
        const body = (await res.json());
        let out;
        try {
            out = JSON.parse(body.message?.content ?? "");
        }
        catch {
            return fallback("unparsable output", started);
        }
        const move = out.move;
        if (!MOVES.includes(move))
            return fallback("invalid move", started);
        if (move === "tool" && !MENU_TOOLS.includes(out.tool))
            return fallback("unknown tool", started);
        if ((move === "answer" || move === "ask") && !String(out.answer ?? "").trim())
            return fallback("empty answer", started);
        return {
            move,
            ...(move === "tool" ? { tool: String(out.tool), args: out.args ?? {} } : {}),
            ...(move === "escalate" ? { tier: out.tier ?? "standard" } : {}),
            ...(String(out.say ?? "").trim() ? { say: String(out.say) } : {}),
            ...(String(out.answer ?? "").trim() ? { answer: String(out.answer) } : {}),
            ms: Date.now() - started,
        };
    }
    catch (error) {
        return fallback(controller.signal.aborted ? "timeout" : `error: ${error instanceof Error ? error.message : String(error)}`, started);
    }
    finally {
        clearTimeout(timer);
    }
}
/**
 * Keep the local models in memory at the context size each is called with (2026-10-14). Only
 * what is missing — or loaded at another num_ctx, which Ollama would reload on the next call —
 * is loaded. Returns the models it loaded. Never throws.
 */
export async function keepWarm(models, { fetchImpl = fetch, baseUrl = "http://127.0.0.1:11434" } = {}) {
    try {
        const ps = await fetchImpl(`${baseUrl}/api/ps`).then((r) => r.json());
        const loaded = ps.models ?? [];
        const cold = models.filter(({ model, numCtx }) => !loaded.some((m) => (m.name ?? m.model) === model && m.context_length === numCtx));
        for (const { model, numCtx } of cold) {
            await fetchImpl(`${baseUrl}/api/generate`, { method: "POST", headers: { "content-type": "application/json" },
                body: JSON.stringify({ model, keep_alive: "24h", options: { num_ctx: numCtx } }) });
        }
        return cold.map((m) => m.model);
    }
    catch {
        return [];
    }
}
