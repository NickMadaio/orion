/*
 The live layer's models and scripts. Everything runs on Ollama on this Mac, never a cloud model (Nick, 2026-10-16 and 2026-11-04):
   desk    the front desk (move picker), any local model, production prompt and options (front-desk.ts decide())
   ask     the schedule form the worker fills, production prompt, schema and options (schedule-flow.ts FORM_OPTIONS)
   worker  the worker's free reply and tool calls: the production system prompt the router built, with exec and tool_call offered
           as tools. Tool calls go through the plugin's own guards (Session.runTool). The scheduler and the agenda run for real,
           but only in the sandbox calendar Session writes under a temp ORION_CONTROLLED_DIR; nothing else runs.
 What this does NOT reproduce: the gateway's full tool list and its own prompt wrapper. It measures the models on the routing's
 own prompts, which is where the audit found the failures.
*/
import { execFile } from "node:child_process";
import { decide, FRONT_DESK_CTX } from "../front-desk.js";
import { FORM_OPTIONS, RESCHEDULE } from "../schedule-flow.js";
const OLLAMA = "http://127.0.0.1:11434";
const AGENDA = RESCHEDULE.replace(/orion-reschedule$/, "orion-agenda");
const WORKER_OPTIONS = { temperature: 0.2, top_p: 0.9, num_predict: 700, num_ctx: FORM_OPTIONS.num_ctx };
const TOOLS = [
    { type: "function", function: { name: "exec", description: "Run one ORION script with plain arguments, e.g. orion-reschedule move \"Gym\" --to 19:00", parameters: { type: "object", properties: { command: { type: "string" } }, required: ["command"] } } },
    { type: "function", function: { name: "tool_call", description: "Call an ORION tool by id with args", parameters: { type: "object", properties: { id: { type: "string" }, args: { type: "object" } }, required: ["id", "args"] } } },
];
const runScript = (file, args) => new Promise((resolve) => execFile(file, args, { timeout: 60_000, maxBuffer: 1 << 20, env: process.env }, (e, stdout, stderr) => resolve({ stdout: `${String(stdout ?? "")}${String(stderr ?? "")}`, code: e ? 1 : 0 })));
/** "orion-reschedule move \"Gym\" --to 19:00" -> ["orion-reschedule", "move", "Gym", "--to", "19:00"] (quotes only; no shell). */
export const words = (line) => [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((m) => m[1] ?? m[2] ?? m[3] ?? "");
async function chat(model, body, timeoutMs) {
    try {
        const res = await fetch(`${OLLAMA}/api/chat`, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(timeoutMs),
            body: JSON.stringify({ model, stream: false, think: false, keep_alive: "30m", ...body }) });
        return res.ok ? (await res.json()) : null;
    }
    catch {
        return null;
    }
}
export function liveHooks(models, day) {
    return {
        ...(day ? { day } : {}),
        desk: (input) => decide(input, { model: models.desk, timeoutMs: 20_000 }),
        ask: async (system, user, schema, budgetMs) => {
            const out = await chat(models.worker, { format: schema, options: FORM_OPTIONS, messages: [{ role: "system", content: system }, { role: "user", content: user }] }, budgetMs ?? 60_000);
            try {
                return JSON.parse(out?.message?.content ?? "");
            }
            catch {
                return null;
            }
        },
        reschedule: (args) => runScript(RESCHEDULE, args),
        tool: async (toolName, params) => {
            if (toolName !== "exec")
                return "ok";
            const [script, ...args] = words(String(params.command ?? ""));
            if (script?.endsWith("orion-reschedule"))
                return (await runScript(RESCHEDULE, args)).stdout || "ok";
            if (script?.endsWith("orion-agenda"))
                return (await runScript(AGENDA, args)).stdout || "ok";
            return "Not run: the replay sandbox only runs the scheduler and the agenda.";
        },
        worker: async ({ prompt, say, retry, runTool }) => {
            const messages = [{ role: "system", content: prompt }, { role: "user", content: say }, ...(retry ? [{ role: "user", content: retry }] : [])];
            for (let round = 0; round < 4; round += 1) {
                const out = await chat(models.worker, { tools: TOOLS, options: WORKER_OPTIONS, messages }, 120_000);
                const message = out?.message;
                if (!message)
                    return "";
                const calls = message.tool_calls ?? [];
                if (!calls.length)
                    return (message.content ?? "").trim();
                messages.push({ role: "assistant", content: message.content ?? "", tool_calls: calls });
                for (const call of calls) {
                    const name = call.function?.name ?? "";
                    const raw = call.function?.arguments;
                    const params = (typeof raw === "string" ? (() => { try {
                        return JSON.parse(raw);
                    }
                    catch {
                        return {};
                    } })() : raw ?? {});
                    messages.push({ role: "tool", tool_name: name, content: await runTool(name, params) });
                }
            }
            return "";
        },
    };
}
/** Loads a model at the context it is called with, so the first measured turn is not a cold start. */
export async function warm(model, numCtx) {
    await fetch(`${OLLAMA}/api/generate`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ model, keep_alive: "30m", options: { num_ctx: numCtx } }), signal: AbortSignal.timeout(300_000) }).catch(() => undefined);
}
export const warmModels = async (m) => { await warm(m.desk, FRONT_DESK_CTX); await warm(m.worker, FORM_OPTIONS.num_ctx); };
/** What Ollama says is loaded right now (resident size includes the KV cache at the context in use). */
export async function resident() {
    try {
        const ps = (await (await fetch(`${OLLAMA}/api/ps`)).json());
        return (ps.models ?? []).map((m) => ({ name: String(m.name ?? m.model), gib: Math.round(((m.size ?? 0) / 2 ** 30) * 10) / 10, vramGib: Math.round(((m.size_vram ?? 0) / 2 ** 30) * 10) / 10, ctx: m.context_length ?? 0 }));
    }
    catch {
        return [];
    }
}
