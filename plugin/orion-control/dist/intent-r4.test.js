// Live run 4 (docs/audits/2026-10-20-live-as-nick.md, "Run 4", main f506bba, 10-21 03:45-03:54): the false block on plain adds, the garbled
// "move gym from 7 to 8", and the focus session started for "lunch 45 min today at 1pm". Fixtures only: stub scheduler, no model, no session.
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { readIntent } from "./calendar-intent.js";
import { registerLocalRouting } from "./local-routing.js";
import { runScheduleFlow, spokenReply } from "./schedule-flow.js";
import { startsSession } from "./session-flow.js";
import { repairStart, timeMismatch } from "./time-backstop.js";
const at = (h, m = 0) => new Date(2030, 9, 21, h, m);
// 10-21 at 03:46: two classes, and the Gym added at 19:00 in #2a.
const day = (now = "03:46", extra = []) => ({ date: "2030-10-21", now, plan: { commuteMinutes: 45, bufferMinutes: 5, anchors: [{ title: "Gym", minutes: 90 }] }, blocks: [
        { title: "CS1802 Seminar — Lecture", start: "09:00", end: "10:30", fixed: true, kind: "class" },
        { title: "CS2100 Program Design — Lecture", start: "11:00", end: "12:30", fixed: true, kind: "class" }, ...extra
    ] });
const GYM = { title: "Gym", start: "19:00", end: "20:30", fixed: false, kind: "gym" };
async function flow(message, opts = {}) {
    const writes = [];
    const result = await runScheduleFlow({ message, clock: "Wed 03:46", now: opts.now ?? at(3, 46),
        ask: async () => { if (!opts.steps)
            throw new Error("the form must not be asked"); return { steps: opts.steps }; },
        exec: async (a) => { if (a[0] !== "show" && !a.includes("--dry-run"))
            writes.push(a); return { stdout: a[0] === "show" ? JSON.stringify(opts.d ?? day()) : opts.out ?? "Changed:", code: 0 }; } });
    return { result, writes };
}
describe("1. run 4 #7 and #9: a plain add at a time he said is booked at that time (no false block)", () => {
    it.each([
        ["45 min walk today at 5pm", { name: "walk", minutes: 45, start: "17:00" }],
        ["need to do laundry, 1 hr, today at 6pm", { name: "laundry", minutes: 60, start: "18:00" }],
        ["lunch 45 min today at 1pm", { name: "lunch", minutes: 45, start: "13:00" }],
        ["walk 30 min this evening at 5", { name: "walk", minutes: 30, start: "17:00" }],
        ["reading for an hour tonight at 9", { name: "reading", minutes: 60, start: "21:00" }],
    ])("%j reads as an add", (m, item) => {
        expect(readIntent(m, { now: at(3, 50) })).toMatchObject({ intent: { verb: "add", items: [item] } });
    });
    it.each(["my class ends at 5 today", "the gym is at 6 today", "lunch was at 1pm today", "i had lunch today at 1pm", "lunch at 1pm today?", "my lecture today at 11"])("%j is not an add", (m) => {
        expect(readIntent(m, { now: at(3, 50) })).not.toHaveProperty("intent");
    });
    it.each([
        ["45 min walk today at 5pm", "add walk 45 --at 17:00", "planned walk: 17:00–17:45", "Done: walk 5:00 PM–5:45 PM."],
        ["need to do laundry, 1 hr, today at 6pm", "add laundry 60 --at 18:00", "planned laundry: 18:00–19:00", "Done: laundry 6:00 PM–7:00 PM."],
    ])("%j writes `%s` and says %j", async (m, argv, out, reply) => {
        const { result, writes } = await flow(m, { out: `Changed Wednesday 2030-10-21:\n  ${out}\nWritten to his calendar.` });
        expect(writes).toEqual([argv.split(" ")]);
        expect(result.outcome).toBe("done");
        expect(spokenReply(result.outputs)).toBe(reply);
    });
    it("the form's write that left the time out (what run 4 actually wrote: `add walk 45`, no --at) gets the 17:00 he said, and runs", async () => {
        expect(timeMismatch("45 min walk today at 5pm, if there's room", [["add", "walk", "45"]], { day: "today", now: 226 })).toMatch(/wherever there was room/);
        expect(repairStart("45 min walk today at 5pm, if there's room", [["add", "walk", "45"]], { day: "today", now: 226 })).toEqual([["add", "walk", "45", "--at", "17:00"]]);
        const { writes } = await flow("45 min walk today at 5pm, if there's room", { steps: [{ do: "add", what: "walk", minutes: 45 }], out: "Changed:\n  planned walk: 17:00–17:45" });
        expect(writes).toEqual([["add", "walk", "45", "--at", "17:00"]]);
    });
    it.each([
        [[["add", "walk", "45", "--at", "13:20"]], undefined], // a different time is never "repaired"
        [[["add", "walk", "45", "--after", "CS2100"]], undefined], // an anchor he did not say is not overwritten
        [[["add", "walk", "45"], ["add", "lunch", "30"]], undefined], // two writes: which one?
    ])("repairStart leaves %j alone", (argvs, want) => {
        expect(repairStart("45 min walk today at 5pm", argvs, { day: "today", now: 226 })).toEqual(want);
    });
});
describe("2. run 4 #2b: 'move gym from 7 to 8' with the Gym at 19:00 moves it to 20:00, at 03:47 too", () => {
    it.each([
        ["move gym from 7 to 8", ["move", "Gym", "--to", "20:00"]],
        ["move gym to 8", ["move", "Gym", "--to", "20:00"]],
        ["push gym from 7 to 7:30", ["move", "Gym", "--to", "19:30"]],
        ["move gym from 7pm to 8pm", ["move", "Gym", "--to", "20:00"]],
    ])("%j -> %j", async (m, argv) => {
        const { writes, result } = await flow(m, { d: day("03:47", [GYM]), now: at(3, 47), out: "Changed:\n  Gym moved: 19:00 → 20:00–21:30" });
        expect(writes).toEqual([argv]);
        expect(spokenReply(result.outputs)).toBe("Done: Gym now 8:00 PM–9:30 PM.");
    });
    it("a 'from' that is not where the block is: said, nothing moved", async () => {
        const { writes, result } = await flow("move gym from 6 to 8", { d: day("03:47", [GYM]), now: at(3, 47) });
        expect(writes).toEqual([]);
        expect(result).toMatchObject({ outcome: "say", text: "Gym is at 7:00 PM, not 6:00 PM, so I haven't moved it. Tell me where it should go, like \"move gym to 8 PM\"." });
    });
    it("the backstop accepts either half for a move's bare 'to' (the writer reads it against the block), but not a contradicted am/pm", () => {
        expect(timeMismatch("move gym from 7 to 8", [["move", "Gym", "--to", "20:00"]], { day: "today", now: 227 })).toBeUndefined();
        expect(timeMismatch("move gym from 7 to 8am", [["move", "Gym", "--to", "20:00"]], { day: "today", now: 227 })).toMatch(/^You said 8:00 AM/);
    });
});
describe("3. run 4 #10: a meal or activity with a time is a calendar add, never a focus session", () => {
    const LUNCH_HINT = { start: true, task: "lunch", minutes: 45 };
    it.each([
        ["lunch 45 min today at 1pm", LUNCH_HINT], ["make it an hour", { start: true }], ["gym 30 min at 6", { start: true }], ["dinner at 7", { start: true }],
        ["add a 45 min reading block", { start: true }], ["nap 20 min", { start: true }], ["start my lunch at 1pm", {}], ["start work on the laundry at 6", {}],
        ["start a study block at 3pm", {}], ["walk for 45 minutes", { start: true }],
    ])("%j (desk hint %j) is not a session", (m, hint) => {
        expect(startsSession(m, hint)).toBe(false);
    });
    it.each([
        ["start a focus session for 45 min", {}], ["lock in for an hour", { start: true }], ["pomodoro 25 min", { start: true }], ["start a focus session until 8:30 pm", {}],
        ["focus mode on for an hour, leetcode", {}], ["start a 25 minute timer session", { start: true }],
    ])("%j (desk hint %j) is a session", (m, hint) => {
        expect(startsSession(m, hint)).toBe(true);
    });
    it("through the hooks, with the desk reading a lunch session (run 4's exact decision): the calendar flow runs, the session flow never", async () => {
        const handlers = new Map();
        const sessions = [];
        const sched = [];
        registerLocalRouting({ on: (n, f) => handlers.set(n, [...(handlers.get(n) ?? []), f]) }, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "r4-")), "r.jsonl"),
            brainSearch: async () => "", clock: () => "Wed 03:52", now: () => at(3, 52),
            decideImpl: async () => ({ move: "tool", tool: "session", args: { do: "start", task: "lunch", minutes: "45" }, say: "Starting your 45-minute lunch session at 1 PM." }),
            sessionFlow: async (m) => { sessions.push(m); return { outcome: "done", reply: "Your focus session is running: 45 minutes.", calls: ["exec orion-session start lunch --minutes 45 --json"], outputs: ["ok"] }; },
            scheduleFlow: async (m) => { sched.push(m); return { outcome: "done", calls: ["exec orion-reschedule add lunch 45 --at 13:00"], outputs: ["Changed:\n  planned lunch: 13:00–13:45"] }; } });
        for (const [id, m] of [["l1", "lunch 45 min today at 1pm"], ["l2", "make it an hour"]]) {
            const c = { runId: id, sessionKey: "agent:main:orion-chat-live-u10" };
            for (const f of handlers.get("before_model_resolve") ?? [])
                await f({ prompt: m }, c);
            for (const f of handlers.get("before_prompt_build") ?? [])
                await f({ prompt: m, messages: [] }, c);
        }
        expect(sessions).toEqual([]);
        expect(sched[0]).toBe("lunch 45 min today at 1pm");
    });
});
