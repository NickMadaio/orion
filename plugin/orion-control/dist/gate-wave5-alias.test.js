// Gate run-1031224700, wave 5: he calls blocks by everyday names. "marketing" is MKTG2201, "macro"/"econ" is ECON1115, "side project
// tonight" is the Side project block; ORION said each was not on his day. Through the routing hooks, with NO course data (only the generic
// code-prefix rules), so this holds before USER.md or the brain is read. Phrasings are held out from scripts/eval/gate/scenarios/.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { registerLocalRouting } from "./local-routing.js";
import { useCourseAliases } from "./block-names.js";
import { runScheduleFlow } from "./schedule-flow.js";
beforeAll(() => useCourseAliases(new Map()));
afterAll(() => useCourseAliases(undefined));
const MON = (h, m = 0) => new Date(2026, 10, 2, h, m);
const PLAN = { commuteMinutes: 45, bufferMinutes: 5, anchors: [{ title: "Gym", minutes: 90 }] };
const TODAY = { date: "2026-11-02", now: null, plan: PLAN, blocks: [
        { title: "ECON1115", start: "11:00", end: "12:30", fixed: true, kind: "class" },
        { title: "MKTG2201", start: "13:30", end: "15:30", fixed: true, kind: "class" },
        { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" },
        { title: "Side project", start: "19:30", end: "20:30", fixed: false, kind: "side_project" },
    ] };
function route(decide, now, day = TODAY) {
    const handlers = new Map();
    const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
    const fire = async (n, e, c) => { const o = []; for (const fn of handlers.get(n) ?? [])
        o.push(await fn(e, c)); return o; };
    const dir = mkdtempSync(join(tmpdir(), "wave5-alias-"));
    const runs = [];
    const flows = [];
    const stdout = (args) => {
        if (args[0] === "add" && args.includes("--kind"))
            return '{"id":"f1"}';
        if (args[0] === "classes-off")
            return args.slice(1).filter((a) => /^[A-Z]{2,5}\d+$/.test(a)).map((c) => `cancelled ${c} ${c === "ECON1115" ? "11:00–12:30" : "13:30–15:30"}`).join("\n") + "\nWritten to his calendar.";
        if (args[0] === "move")
            return "moved Gym: 17:00 → 15:35\nWritten to his calendar.";
        if (args[0] === "drop")
            return "dropped Side project 19:30–20:30\nWritten to his calendar.";
        return "Written to his calendar.";
    };
    const run = async (_s, args) => { runs.push(args); return { stdout: stdout(args), code: 0 }; };
    registerLocalRouting(api, { warm: false, mode: "on", logPath: join(dir, "r.jsonl"), progressDir: join(dir, "tp"), stateDir: dir, clock: () => "Mon", now: () => now,
        decideImpl: async (i) => decide(i.message),
        brainSearch: async () => "",
        scheduleFlow: async (m) => { flows.push(m); return { outcome: "say", kind: "ask", text: "What time or how long do you mean? I haven't changed anything." }; },
        readDayJson: async () => ({ ...day, now: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` }),
        readDeadlines: async () => ({ events: [], tasks: [] }),
        realityRun: run, calendarRun: run, scheduleRun: run, });
    let n = 0;
    const turn = async (prompt) => {
        const ctx = { runId: `w5a-${n += 1}`, sessionKey: "agent:main:orion-chat-w5a" };
        await fire("before_model_resolve", { prompt }, ctx);
        const [direct] = (await fire("before_agent_reply", { cleanedBody: prompt }, ctx));
        const [built] = (await fire("before_prompt_build", { prompt, messages: [] }, ctx));
        const exact = /Your whole reply must be exactly: ([\s\S]*)\]$/.exec(built?.appendContext ?? "")?.[1];
        return direct?.reply?.text ?? exact ?? "";
    };
    return { turn, runs, flows };
}
const escalate = () => ({ move: "escalate", tier: "standard" });
const NOT_THERE = /(?:don't see|isn't on|aren't on|no \w+ (?:class|block) |There's no)/i;
describe("classes named by subject are cancelled (sch-no-class, rea-correction-queued)", () => {
    it.each([
        ["i dont have macro or mktg today, both cancelled, fill the time", true],
        ["no macro and no mktg today, cancel those leave pings", false],
        ["i dont have econ or marketing today theyre cancelled", false],
    ])("%s", async (said, fill) => {
        const r = route(escalate, MON(10));
        const reply = await r.turn(said);
        const off = r.runs.find((a) => a[0] === "classes-off");
        expect(off).toBeDefined();
        expect(off).toEqual(expect.arrayContaining(["ECON1115", "MKTG2201"]));
        expect(reply).not.toMatch(NOT_THERE);
        expect(reply).toMatch(/ECON1115/);
        if (fill)
            expect(r.runs.some((a) => a[0] === "fill")).toBe(true);
    });
});
describe("a missed class is recorded by its subject name (rea-didnt-go-class)", () => {
    it.each(["missed marketing today oops", "didnt go to mktg today", "i skipped macro this morning"])("%s", async (said) => {
        const r = route(escalate, MON(15, 45));
        const reply = await r.turn(said);
        const skip = r.runs.find((a) => a.includes("--kind") && a.includes("skip"));
        expect(skip?.[skip.indexOf("--title") + 1]).toMatch(/^(?:MKTG2201|ECON1115)$/);
        expect(reply).not.toMatch(NOT_THERE);
        expect(reply).toMatch(/missed (?:MKTG2201|ECON1115)/);
    });
});
describe("gym after a class named by subject (sch-gym-after-home, loop-voice-cutoff)", () => {
    it.each(["can u put gym after my mktg lecture", "move gym to after mktg", "shift gym to after marketing class pls",
        '(Continuing — my last message was cut off, my full message was: "could you move the gym to after my econ lecture")'])("%s", async (said) => {
        const r = route(escalate, MON(10));
        const reply = await r.turn(said);
        expect(reply).not.toMatch(NOT_THERE);
        const write = r.runs.find((a) => ["move", "day"].includes(a[0]));
        expect(write).toBeDefined();
        expect(write.join(" ")).toMatch(/MKTG2201|ECON1115|1[56]:\d\d/);
    });
});
// The replan and a removal by name are read inside the schedule flow; run it with a fake scheduler, as day-replan.test.ts does.
async function flow(message, day, now) {
    const calls = [];
    const shown = { ...day, now: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}` };
    const result = await runScheduleFlow({ message, clock: "Mon 10:00", now,
        exec: async (args) => { calls.push(args); return args[0] === "show" ? { stdout: JSON.stringify(shown), code: 0 } : { stdout: "Changed Monday 2026-11-02:\n  moved Gym: 17:00 → 16:20\nWritten to his calendar.", code: 0 }; },
        ask: async () => null });
    return { result, calls };
}
describe("gym first after a class named by subject, through the replan (sch-gym-after-home)", () => {
    it.each([
        "reschedule the rest of my day after mktg, gym first when i get home",
        "replan my afternoon after my econ lecture, put gym first when im back home",
        "redo my day after marketing but gym first once i get back",
    ])("%s", async (said) => {
        const { result, calls } = await flow(said, TODAY, MON(10));
        const text = JSON.stringify(result);
        expect(text).not.toMatch(NOT_THERE);
        const plan = calls.find((a) => a[0] === "day");
        expect(plan).toBeDefined();
        // MKTG2201 ends 15:30; 45 min home and the 5 min buffer. After ECON1115 (12:30) 90 min of gym would sit on MKTG2201, so it fits after that.
        expect(plan.join(" ")).toMatch(/Gym, 90, 16:20/);
    });
});
describe("his own block named with filler words is found (sch-cancel-owned)", () => {
    it.each(["remove the side project block tonite", "drop my side project tonight", "delete side project for tonight"])("%s", async (said) => {
        const { result, calls } = await flow(said, TODAY, MON(10));
        expect(JSON.stringify(result)).not.toMatch(NOT_THERE);
        expect(calls.find((a) => a[0] !== "show")).toEqual(["drop", "Side project"]);
    });
});
describe("one name for a class and a study block: the verb decides", () => {
    const day = { ...TODAY, blocks: [...TODAY.blocks, { title: "Econ problem set", start: "16:00", end: "16:55", fixed: false, kind: "study" }] };
    it("a missed class goes to the class", async () => {
        const r = route(escalate, MON(15, 45), day);
        await r.turn("i skipped econ this morning");
        const skip = r.runs.find((a) => a.includes("--kind") && a.includes("skip"));
        expect(skip?.[skip.indexOf("--title") + 1]).toBe("ECON1115");
    });
});
