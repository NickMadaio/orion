import { describe, expect, it } from "vitest";
import { planReminder } from "./reminder-flow.js";
import { runScheduleFlow } from "./schedule-flow.js";
import { parseSessionRequest } from "./session-flow.js";
import { toolDirective } from "./tool-moves.js";
import { parseWake, runWakeFlow } from "./wake-flow.js";
// Live, 2026-10-19 01:43: "going to bed now" -> the 4B front desk invented wake at 07:00 and ORION moved his
// alarm ("Your wake alarm is now 7:00 AM."). A time, length or title only the front desk produced is never his.
const NIGHT = new Date(2026, 9, 19, 1, 43);
const DESK_0700 = { move: "tool", tool: "wake", args: { at: "07:00" } };
const CURRENT = "Wake-up set for Mon, 07:45 (asked 2026-10-18T22:00:00.000Z).";
const SENT = "Sent to Nick's iPhone: alarm for Monday, 07:00. The phone sets it the next time ORION refreshes there.";
const stub = (stdout) => { const calls = []; const exec = async (args) => { calls.push(args); return { stdout, code: 0 }; }; return { calls, exec }; };
describe("wake alarm: a time must be his", () => {
    it("'going to bed now' with a desk-invented 07:00 changes nothing and says goodnight", async () => {
        expect(parseWake("going to bed now", DESK_0700, NIGHT)).toEqual({ kind: "bedtime" });
        const s = stub(CURRENT);
        const flow = await runWakeFlow({ message: "going to bed now", decision: DESK_0700, now: NIGHT, exec: s.exec });
        expect(s.calls).toEqual([[]]); // a read of the real alarm, never a set
        expect(flow).toMatchObject({ outcome: "say", text: "Goodnight. Your wake alarm is still set for Mon, 07:45." });
    });
    it("goodnight with no alarm state read still changes nothing", async () => {
        const bad = async () => ({ stdout: "boom", code: 1 });
        expect(await runWakeFlow({ message: "going to bed now", decision: DESK_0700, now: NIGHT, exec: bad })).toMatchObject({ outcome: "say", text: "Goodnight." });
    });
    it("a desk time alone never sets, whatever he said", () => {
        for (const said of ["going to bed at 11", "ok good night", "make it a bit later", "set my alarm"]) {
            const req = parseWake(said, DESK_0700, NIGHT);
            expect(req && req.kind === "set" ? req : null, said).toBeNull();
        }
    });
    it("'wake me at 7' changes the alarm", async () => {
        const s = stub(SENT);
        const flow = await runWakeFlow({ message: "wake me at 7", decision: DESK_0700, now: NIGHT, exec: s.exec });
        expect(s.calls).toEqual([["07:00"]]);
        expect(flow).toMatchObject({ outcome: "done", reply: "Your wake alarm is now 7:00 AM." });
    });
    it("'push my alarm to 12' changes the alarm, not a reminder", async () => {
        const s = stub(SENT);
        const flow = await runWakeFlow({ message: "push my alarm to 12", now: NIGHT, exec: s.exec });
        expect(s.calls).toEqual([["12:00"]]);
        expect(flow).toMatchObject({ outcome: "done", calls: ["exec orion-wake 12:00"], reply: "Your wake alarm is now 12:00 PM." });
    });
    it("his bare reply to 'what time?' is a time of his; the same reply cold is not", () => {
        expect(parseWake("7", DESK_0700, NIGHT, true)).toEqual({ kind: "set", time: "07:00" });
        expect(parseWake("7:30am", undefined, NIGHT, true)).toEqual({ kind: "set", time: "07:30" });
        expect(parseWake("7", DESK_0700, NIGHT, false)).toBeNull();
    });
});
describe("other flows: a desk- or extractor-invented value writes nothing", () => {
    it("reminder: an extractor time with none in his words asks instead of setting", async () => {
        const plan = await planReminder({ message: "remind me to take out the bins", now: NIGHT, extract: async () => ({ time: "07:00", label: "take out the bins" }), list: async () => [] });
        expect(plan).toMatchObject({ kind: "say", text: expect.stringMatching(/What time/) });
        const pills = await planReminder({ message: "remind me to take 2 pills", now: NIGHT, extract: async () => ({ time: "07:00", label: "take 2 pills" }), list: async () => [] });
        expect(pills).toMatchObject({ kind: "say", text: expect.stringMatching(/What time/) });
        for (const said of ["remind me tonight to call mom", "remind me tomorrow to call mom", "remind me this morning to call mom"]) {
            const day = await planReminder({ message: said, now: NIGHT, extract: async () => ({ time: "20:00", label: "call mom" }), list: async () => [] });
            expect(day, said).toMatchObject({ kind: "say", text: expect.stringMatching(/What time/) });
        }
        const named = await planReminder({ message: "remind me to take out the bins at 7am", now: NIGHT, extract: async () => ({ time: "07:00", label: "take out the bins" }), list: async () => [] });
        expect(named).toMatchObject({ kind: "call", action: "alarm_set" });
    });
    const day = { date: "2026-10-19", now: "01:43", blocks: [{ title: "lunch", start: "12:00", end: "12:30", fixed: false }] };
    const schedule = async (message, to) => {
        const calls = [];
        const r = await runScheduleFlow({ message, clock: "Mon 01:43", now: NIGHT,
            exec: async (a) => { calls.push(a); return { stdout: a[0] === "show" ? JSON.stringify(day) : "Written to his calendar.", code: 0 }; },
            ask: async () => ({ steps: [{ do: "move", what: "B1", to }] }) });
        return { r, writes: calls.filter((a) => a[0] !== "show") };
    };
    it("schedule: a form time with none in his words writes nothing", async () => {
        const { r, writes } = await schedule("move lunch later", "07:00");
        expect(writes).toEqual([]);
        expect(r).toMatchObject({ outcome: "say", kind: "ask" });
        expect((await schedule("move lunch to 1pm", "13:00")).writes).toEqual([["move", "lunch", "--to", "13:00"]]);
    });
    it("schedule: a course code is not a time; a desk add length is dropped for the default", async () => {
        const { r, writes } = await schedule("move CS1800 review later", "07:00");
        expect(writes).toEqual([]);
        expect(r).toMatchObject({ outcome: "say", kind: "ask" });
        const add = async (message) => {
            const calls = [];
            await runScheduleFlow({ message, clock: "Mon 01:43", now: NIGHT,
                exec: async (a) => { calls.push(a); return { stdout: a[0] === "show" ? JSON.stringify(day) : "Written to his calendar.", code: 0 }; },
                ask: async () => ({ steps: [{ do: "add", what: "reading", minutes: 90 }] }) });
            return calls.find((c) => c[0] === "add" && !c.includes("--dry-run"));
        };
        expect((await add("add reading please"))?.[2]).toBe("30");
        expect((await add("add reading for 45 min"))?.[2]).toBe("90"); // his length is kept as the form gave it
    });
    it("session: a desk length is ignored, a desk task only when his words contain it", () => {
        expect(parseSessionRequest("start a focus session", { start: true, task: "invented essay", minutes: 90 })).toEqual({ task: "Focus", apps: [] });
        expect(parseSessionRequest("focus mode on for an hour, leetcode", { start: true, task: "leetcode", minutes: 90 })).toMatchObject({ task: "leetcode", minutes: 60 });
    });
    it("supplement: a desk-invented name never logs a dose", () => {
        const desk = (name) => ({ move: "tool", tool: "supplements", args: { do: "take", name } });
        expect(toolDirective(desk("magnesium"), "going to bed now")).toBeNull();
        expect(toolDirective(desk("creatine"), "took my creatine")).toMatchObject({ kind: "call", action: "supplement_take" });
    });
});
