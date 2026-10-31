// Gate run-1031202318, wave 4 clusters 6 and 7, through the routing hooks: a defaultable request is acted on by code (day-defaults.ts)
// whatever the front desk drafted, and "what now" is read from the calendar. Phrasings are held out from scripts/eval/gate/scenarios/.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
const MON = (h, m = 0) => new Date(2026, 10, 2, h, m);
const TODAY = { date: "2026-11-02", now: null, plan: { commuteMinutes: 20, bufferMinutes: 5, anchors: [] }, blocks: [
        { title: "MKTG2201", start: "13:30", end: "15:30", fixed: true, kind: "class" },
        { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" },
        { title: "Side project", start: "19:30", end: "20:30", fixed: false, kind: "side_project" },
    ] };
const TOMORROW = { date: "2026-11-03", now: null, plan: { commuteMinutes: 20, bufferMinutes: 5, anchors: [] }, blocks: [
        { title: "CS2100", start: "09:00", end: "10:30", fixed: true, kind: "class" },
        { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" },
        { title: "Side project", start: "19:30", end: "20:30", fixed: false, kind: "side_project" },
    ] };
function route(decide, now) {
    const handlers = new Map();
    const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
        o.push(await fn(e, c)); return o; };
    const dir = mkdtempSync(join(tmpdir(), "wave4-cg-"));
    const runs = [];
    const desk = [];
    const flows = [];
    const sessions = [];
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), stateDir: dir, clock: () => "Mon", now: () => now,
        decideImpl: async (i) => { desk.push(i.message); return decide(i.message); },
        brainSearch: async () => "",
        scheduleFlow: async (m) => { flows.push(m); return { outcome: "say", kind: "ask", text: "What time or how long do you mean? I haven't changed anything." }; },
        readDayJson: async (a) => (a.includes("tomorrow") ? TOMORROW : TODAY), readDeadlines: async () => ({ events: [], tasks: [] }),
        realityRun: async (_s, args) => { runs.push(args); return { stdout: args[0] === "busy" ? "moved Gym: 17:00 → 18:35\nWritten to his calendar." : "Written to his calendar.", code: 0 }; },
        sessionFlow: async (m) => { sessions.push(m); return { outcome: "done", calls: [], outputs: [], reply: "Your focus session is running." }; },
    });
    let n = 0;
    const turn = async (prompt) => {
        const ctx = { runId: `w4cg-${n += 1}`, sessionKey: "agent:main:orion-chat-w4cg" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx));
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        const exact = /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1];
        return direct?.reply?.text ?? exact ?? "";
    };
    return { turn, runs, desk, flows, sessions };
}
describe("cluster 7: 'what now' is the calendar's answer, not the desk's draft", () => {
    it.each(["ok so what now", "alright what am i supposed to be doing rn", "k what should i do next"])("%s at 17:00 says gym is now", async (said) => {
        const r = route(() => ({ move: "answer", answer: "You're all caught up. Go get some rest." }), MON(17));
        const reply = await r.turn(said);
        expect(reply).toMatch(/Gym, now \(5:00–6:30 PM\)/);
        expect(reply).not.toMatch(/caught up/);
        expect(r.desk).toEqual([]);
        expect(r.runs).toEqual([]);
    });
    it("a bare 'ok' to a stale 'Next:' line is corrected from the calendar, and never starts a session", async () => {
        const r = route(() => ({ move: "tool", tool: "session", args: { do: "start" } }), MON(17));
        const reply = await r.turn('[ORION context: you messaged him first, 1 min ago: "Session done. Next: CS2100 at 9:00 AM.". This message MAY be his answer.]\nk cool');
        expect(reply).toMatch(/Correction/);
        expect(reply).toMatch(/Gym, now/);
        expect(reply).not.toMatch(/CS2100 at 9/);
        expect(r.sessions).toEqual([]);
    });
});
describe("cluster 6: defaults, acted on and said", () => {
    it("a friend asking him out now: gym slides out of two hours from now, no clarifier", async () => {
        const r = route(() => ({ move: "answer", answer: "Sounds good. What are you thinking of grabbing?" }), MON(16, 30));
        const reply = await r.turn("my flatmate wants to get dinner rn");
        expect(r.runs).toEqual([["busy", "16:30-18:30", "--why", "dinner with flatmate"]]);
        expect(reply).toMatch(/two hours.*Gym 5:00 PM → 6:35 PM/);
        expect(reply).not.toMatch(/\?$/);
    });
    it("an easy day tomorrow is made easier, not asked about", async () => {
        const r = route(() => ({ move: "escalate", tier: "standard" }), MON(21));
        const reply = await r.turn("gotta keep tmrw easy, so much on");
        expect(r.runs.map((a) => a[0])).toEqual(["resize", "add"]);
        expect(r.runs.every((a) => a.includes("2026-11-03"))).toBe(true);
        expect(reply).toMatch(/Kept tomorrow light/);
        expect(reply).not.toMatch(/What's the one thing/);
    });
    it("something before class lands before the class, not in the evening", async () => {
        const r = route(() => ({ move: "ask", answer: "What class?" }), MON(10));
        const reply = await r.turn("can u fit some revision in before my class");
        expect(r.flows).toEqual([]);
        expect(r.runs).toEqual([["add", "Revision", "30", "--at", "12:55", "--date", "2026-11-02"]]);
        expect(reply).toMatch(/12:55–1:25 PM, right before MKTG2201/);
    });
});
