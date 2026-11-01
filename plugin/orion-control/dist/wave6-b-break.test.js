// Wave 6 B, revised for gate run-1101020721 (foc-pomodoro-break-v): the worker-set return alarm was paraphrased as "10:10 AM tomorrow"
// and the block never resumed. A vague break is now code's timed break (orion-session start --sequence), said by code on pluginNow;
// the worker never sets an alarm for it.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
function setup() {
    const handlers = new Map();
    const api = { on: (name, fn) => handlers.set(name, [...(handlers.get(name) ?? []), fn]) };
    const fire = async (name, event, ctx) => {
        const out = [];
        for (const fn of handlers.get(name) ?? [])
            out.push(await fn(event, ctx));
        return out;
    };
    const calls = [];
    const idle = `${JSON.stringify({ ok: true, status: "finished", phase: "abandoned", task: "econ" })}\n`;
    const sessionExec = async (args) => {
        calls.push(args);
        return args[0] === "start" ? { stdout: `${JSON.stringify({ ok: true, status: "running", phase: "rest", task: args[1], remainingSeconds: 600 })}\n`, code: 0 } : { stdout: idle, code: 0 };
    };
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "w6b-")), "r.jsonl"), brainSearch: async () => "",
        clock: () => "Mon 10:00", now: () => new Date(2026, 10, 2, 10, 0), decideImpl: async () => ({ move: "escalate", tier: "standard" }),
        scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }), sessionExec });
    return { fire, calls };
}
describe("a vague break is run and said by code, on the plugin clock", () => {
    it.each(["need a break", "ok i need a quick break", "gonna take a break real quick"])("%s", async (said) => {
        const { fire, calls } = setup();
        const ctx = { runId: `w6b-${said.length}`, sessionKey: "agent:main:orion-chat-w6b" };
        await fire("before_model_resolve", { prompt: said }, ctx);
        const built = await fire("before_prompt_build", { prompt: said, messages: [] }, ctx);
        expect(built.map((b) => b?.systemPrompt ?? "").join("")).not.toMatch(/alarm_set/);
        expect(calls.find((c) => c[0] === "start")).toEqual(["start", "econ", "--sequence", "10 break, 50 work", "--json"]);
        const [out] = await fire("before_agent_finalize", { sessionId: "s", lastAssistantMessage: "Done. I've set an alarm for 10:10 AM tomorrow." }, ctx);
        const said2 = JSON.stringify(out ?? {});
        expect(said2).toMatch(/Break till 10:10 AM/);
        expect(said2).toMatch(/econ starts again by itself/);
        expect(said2).not.toMatch(/tomorrow/);
    });
});
