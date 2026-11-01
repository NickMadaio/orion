// Wave 6 B (gate run-1101003318, foc-pomodoro-break-v): the break's alarm was set for 10:10 today on the plugin clock, and the worker
// replied "I've set an alarm for 10:10 AM tomorrow" (it read the tool result's due-in against the host clock). Once code's reminder
// is set, the reply is code's line, built on pluginNow; the worker's paraphrase is revised to it.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { TASK_RUN_ID } from "./task-run-wiring.js";
function setup() {
    const handlers = new Map();
    const api = { on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) };
    const fire = async (name, event, ctx) => {
        const out = [];
        for (const fn of handlers.get(name) ?? [])
            out.push(await fn(event, ctx));
        return out;
    };
    const idle = `${JSON.stringify({ ok: true, status: "finished", phase: "abandoned", task: "econ" })}\n`;
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "w6b-")), "r.jsonl"), brainSearch: async () => "",
        clock: () => "Mon 10:00", now: () => new Date(2026, 10, 2, 10, 0), decideImpl: async () => ({ move: "escalate", tier: "standard" }),
        scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }), sessionExec: async () => ({ stdout: idle, code: 0 }) });
    return { fire };
}
describe("a set break alarm is said by code, on the plugin clock", () => {
    it.each(["need a break", "ok i need a quick break", "gonna take a break real quick"])("%s", async (said) => {
        const { fire } = setup();
        const ctx = { runId: `w6b-${said.length}`, sessionKey: "agent:main:orion-chat-w6b" };
        await fire("before_model_resolve", { prompt: said }, ctx);
        await fire("before_prompt_build", { prompt: said, messages: [] }, ctx);
        const args = { steps: [{ action: "alarm_set", at: "2026-11-02T10:10", label: "back from break: econ" }] };
        await fire("after_tool_call", { toolName: "tool_call", params: { id: TASK_RUN_ID, args }, result: "executed=true" }, ctx);
        const [out] = await fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done. I've set an alarm for 10:10 AM tomorrow to remind you to get back to econ." }, ctx);
        expect(out?.retry?.instruction).toMatch(/Break till 10:10 AM/);
        expect(out?.retry?.instruction).not.toMatch(/tomorrow/);
    });
});
