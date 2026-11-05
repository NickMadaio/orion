// Shared harness for the w20 round-4 food / note / list / fix tests: the real routing hooks, with every effect a stub.
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerLocalRouting } from "./local-routing.js";
export const NOW = new Date(2026, 10, 5, 13, 0);
/** A chat session; `turn` returns the direct reply when code owns it, else the drafted system prompt text (what the worker is told to say). */
export function rig(o) {
    const handlers = new Map();
    const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n, e, c) => { const out = []; for (const fn of handlers.get(n) ?? [])
        out.push(await fn(e, c)); return out; };
    const dir = mkdtempSync(join(tmpdir(), "r4-"));
    writeFileSync(join(dir, "health-log.json"), JSON.stringify(o.health ?? { schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [] }));
    const flows = [];
    let clock = NOW.getTime();
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), stateDir: dir, clock: () => "Thu 13:00", now: () => new Date(clock),
        decideImpl: async () => (o.decide ?? { move: "escalate" }), brainSearch: async () => "",
        scheduleFlow: async (m) => { flows.push(m); return o.scheduleFlow ? o.scheduleFlow(m) : { outcome: "fallback", reason: "test" }; },
        readDayJson: async () => o.day, readDeadlines: async () => ({ events: [], tasks: [] }), listReminders: async () => [],
        ...(o.foodRun ? { foodRun: o.foodRun } : {}), ...(o.ledgerRun ? { ledgerRun: o.ledgerRun } : {}), ...(o.selffixRun ? { selffixRun: o.selffixRun } : {}),
        ...(o.extractReminder ? { extractReminder: o.extractReminder } : {}),
        ...(o.noteFlow ? { noteFlow: o.noteFlow } : {}), ...(o.chatRun ? { chatRun: o.chatRun } : {}), ...(o.todoDoneFlow ? { todoDoneFlow: o.todoDoneFlow } : {}), });
    let n = 0;
    const turn = async (prompt) => {
        clock += 30_000;
        const ctx = { runId: `r4-${n += 1}`, sessionKey: "agent:main:orion-chat-r4" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx));
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        await fire("before_agent_finalize", { messages: [{ role: "assistant", content: direct?.reply?.text ?? "ok" }] }, ctx);
        const drafted = built?.systemPrompt ?? "";
        const exact = /do not call any tools:\s*([\s\S]*)$/.exec(drafted)?.[1]?.trim(); // the fixed reply code hands the model to say
        return direct?.reply?.text ?? exact ?? drafted;
    };
    return { turn, dir, flows, fire, setClock: (ms) => { clock = ms; } };
}
