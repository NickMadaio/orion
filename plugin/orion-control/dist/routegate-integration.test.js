// w20 routegate: the shared "did I understand" gate, through the real hooks. Held-out phrasings in Nick's style (voice and typed).
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { QUIET_REPLY } from "./chatter.js";
const SPOKEN = "Nick SAID this out loud and your answer will be SPOKEN: one to three short sentences.\n\nUser message:\n";
// Monday 2 Nov 2026 (the scenarios' setup.now), local time.
const MON = (h, m = 0) => new Date(2026, 10, 2, h, m);
const DAY = { date: "2026-11-02", now: null, blocks: [
        { title: "CS2100 Lecture", start: "09:00", end: "10:30", fixed: true, kind: "class" },
        { title: "MKTG2201 Lecture", start: "13:30", end: "15:30", fixed: true, kind: "class" },
        { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" },
        { title: "Side project", start: "19:30", end: "20:30", fixed: false, kind: "side_project" },
    ] };
const DEADLINES = { events: [
        { title: "CS Midterm", start: new Date(2026, 10, 5, 9, 0).toISOString(), isDeadline: true },
        { title: "Marketing brief", start: new Date(2026, 10, 6, 17, 0).toISOString(), isDeadline: true },
    ], tasks: [] };
function route(decide, opts = {}) {
    const handlers = new Map();
    const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
        o.push(await fn(e, c)); return o; };
    const dir = mkdtempSync(join(tmpdir(), "wave2-"));
    const writes = [];
    const sessionCalls = [];
    const flows = [];
    const sessionFlows = [];
    let session = opts.session ?? null;
    let clock = (opts.now ?? MON(13, 0)).getTime();
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), stateDir: dir, clock: () => "Mon 13:00", now: () => new Date(clock),
        decideImpl: async (i) => decide(i.message), brainSearch: async () => "",
        scheduleFlow: async (m) => { flows.push(m); return { outcome: "fallback", reason: "test" }; },
        readDayJson: async () => opts.day ?? DAY, readDeadlines: async () => DEADLINES,
        realityRun: async (_s, args) => { if (args[0] !== "show")
            writes.push(args); return { stdout: args[0] === "add" ? `Booked ${args[1]} 21:00–22:00` : "ok", code: 0 }; },
        sessionExec: async (args) => {
            sessionCalls.push(args);
            if (args[0] === "status")
                return { stdout: JSON.stringify(session ?? { ok: true, status: "none" }), code: 0 };
            if (args[0] === "pause" && session) {
                session = { ...session, status: "paused" };
                return { stdout: JSON.stringify(session), code: 0 };
            }
            if (args[0] === "finish") {
                session = null;
                return { stdout: JSON.stringify({ ok: true, status: "finished" }), code: 0 };
            }
            if (args[0] === "start") {
                session = { ok: true, status: "running", task: args[1], remainingSeconds: 600 };
                return { stdout: JSON.stringify(session), code: 0 };
            }
            return { stdout: "{}", code: 1 };
        },
        sessionFlow: async (m) => { sessionFlows.push(m); return { outcome: "done", calls: ["exec orion-session start x --json"], outputs: ["{}"], reply: "Your focus session is running: 25 minutes." }; },
        extractReminder: async (m) => ({ time: /\b6\b/.test(m) ? "18:00" : null, label: m.includes("alarm") ? "the army is coming" : "call my mom" }),
        listReminders: async () => [], });
    let n = 0;
    const turn = async (prompt, opt = {}) => {
        const ctx = { runId: `w-${n += 1}`, sessionKey: "agent:main:orion-chat-wave2" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx));
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        const exact = /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1];
        const tool = opt.command ? (await fire("before_tool_call", { toolName: "exec", params: { command: opt.command } }, ctx)).find(Boolean) : undefined;
        const messages = [{ role: "assistant", content: [{ type: "text", text: opt.reply ?? exact ?? "ok" }] }];
        const [fin] = (await fire("before_agent_finalize", { lastAssistantMessage: opt.reply ?? exact ?? "ok", messages }, ctx));
        return { exact, built, direct: direct?.reply?.text, tool, fin, final: JSON.stringify(messages) };
    };
    return { turn, writes, sessionCalls, flows, sessionFlows, advance: (ms) => { clock += ms; } };
}
describe("routegate through the hooks", () => {
    it("A1: narration never starts a focus session, even when the desk says session start", async () => {
        const r = route(() => ({ move: "tool", tool: "session", args: { do: "start" } }));
        const t = await r.turn("Sweet. So let's go ahead and do that. Now that we have that set, I will ask Orion. Orion.");
        expect(r.sessionFlows).toEqual([]);
        expect(t.exact ?? "").not.toMatch(/focus session is running/);
    });
    it("a real session ask still starts one", async () => {
        const r = route(() => ({ move: "tool", tool: "session", args: { do: "start", task: "essay" } }));
        await r.turn("start a focus session for my essay");
        expect(r.sessionFlows.length).toBe(1);
    });
    it("M1: a desk-invented app is never handed to the worker", async () => {
        const r = route(() => ({ move: "tool", tool: "app_open", args: { application: "CS1802 Seminar" } }));
        const t = await r.turn('re-open it one more time please, the "desktop ->" isnt working');
        expect(t.built?.systemPrompt ?? "").not.toMatch(/CS1802/);
    });
    it("A2: a spoken question to ORION the desk calls ignore is answered, not '…'", async () => {
        const r = route(() => ({ move: "ignore" }));
        const t = await r.turn(`${SPOKEN}Can you modify something in your own code?`);
        expect(t.exact).not.toBe(QUIET_REPLY);
    });
    it("room talk the desk calls ignore stays quiet", async () => {
        const r = route(() => ({ move: "ignore" }));
        expect((await r.turn(`${SPOKEN}yeah i told him we would be there at eight`)).exact).toBe(QUIET_REPLY);
    });
    it("a plain multi-request message is split into asks the worker runs and reports one by one", async () => {
        const r = route(() => ({ move: "escalate", tier: "standard" }));
        const t = await r.turn("open safari and set a timer for ten minutes and add milk to my list");
        const p = t.built?.systemPrompt ?? "";
        expect(p).toContain('1. "open safari"');
        expect(p).toContain('2. "set a timer for 10 minutes"');
        expect(p).toContain('3. "add milk to my list"');
        expect(p).toMatch(/EACH/);
    });
    it("a multi-request with a calendar clause stays with the scheduling flow", async () => {
        const r = route(() => ({ move: "escalate", tier: "standard" }));
        const t = await r.turn("open safari and add gym at 10-11");
        expect(t.built?.systemPrompt ?? "").not.toContain("separate things");
    });
});
