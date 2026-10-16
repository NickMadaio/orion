import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseWake, runWakeFlow } from "./wake-flow.js";
import { registerLocalRouting } from "./local-routing.js";
// Live, Nick's phone 2026-10-16 01:45Z: "Push my alarm to 12" got alarm_set "push my alarm" and "Reminder set
// for Friday at 12:00 PM" while the real iPhone wake alarm (scripts/orion-wake) never moved. orion-wake is
// stubbed here; the real script was only run with HOME pointed at a temp dir.
const HIS = "Yea yea yea I know, just wrapping up my work now. Then sleep. Push my alarm to 12";
const WAKE = { move: "tool", tool: "wake", args: { at: "12:00" } };
const NIGHT = new Date(2026, 9, 16, 1, 45);
const SENT = "Sent to Nick's iPhone: alarm for Friday, 12:00. The phone sets it the next time ORION refreshes there.";
const stub = (stdout = SENT, code = 0) => { const calls = []; const exec = async (args) => { calls.push(args); return { stdout, code }; }; return { calls, exec }; };
describe("parseWake", () => {
    it("his exact sentence is a wake alarm at 12:00 (noon, not midnight)", () => {
        expect(parseWake(HIS, WAKE, NIGHT)).toEqual({ kind: "set", time: "12:00" });
        expect(parseWake(HIS, undefined, NIGHT)).toEqual({ kind: "set", time: "12:00" });
    });
    it("sets from loose wording, with am/pm worked out", () => {
        const cases = [
            ["move my alarm to 8", "08:00"], ["wake me up at 7", "07:00"], ["set my alarm for 6:45", "06:45"],
            ["alarm to 9 tomorrow", "09:00"], ["push my alarm to 3pm", "15:00"], ["change my alarm to 7:30 am", "07:30"], ["move my alarm to 14:15", "14:15"],
        ];
        for (const [said, time] of cases)
            expect(parseWake(said, undefined, NIGHT), said).toEqual({ kind: "set", time });
    });
    it("a wake move from the front desk triggers it even when the wording is loose", () => {
        expect(parseWake("make it 7 instead", { move: "tool", tool: "wake", args: { at: "07:00" } }, NIGHT)).toEqual({ kind: "set", time: "07:00" });
    });
    it("clears and reads", () => {
        for (const said of ["clear my alarm", "go back to my normal alarm", "cancel my wake alarm"])
            expect(parseWake(said, undefined, NIGHT), said).toEqual({ kind: "clear" });
        for (const said of ["what's my alarm", "when is my alarm", "what time is my alarm set for?"])
            expect(parseWake(said, undefined, NIGHT), said).toEqual({ kind: "read" });
    });
    it("reminders, timers and repeats are not a one-off wake alarm", () => {
        expect(parseWake("remind me at 5", { move: "tool", tool: "alarm", args: { at: "17:00" } }, NIGHT)).toBeNull();
        expect(parseWake("remind me to call mom at 5, set my alarm for it", undefined, NIGHT)).toBeNull();
        expect(parseWake("set a timer for 10 min", undefined, NIGHT)).toBeNull();
        expect(parseWake("my alarm didn't go off", undefined, NIGHT)).toBeNull();
        expect(parseWake("alarm for 6:45 weekdays", undefined, NIGHT)).toEqual({ kind: "repeat" });
    });
});
describe("runWakeFlow", () => {
    it("runs orion-wake with the 24h time and builds the reply from its output", async () => {
        const s = stub();
        const flow = await runWakeFlow({ message: HIS, decision: WAKE, now: NIGHT, exec: s.exec });
        expect(s.calls).toEqual([["12:00"]]);
        expect(flow).toMatchObject({ outcome: "done", reply: "Your wake alarm is now 12:00 PM.", calls: ["exec orion-wake 12:00"] });
    });
    it("says so when the phone link is down or the script fails, never 'done'", async () => {
        const down = await runWakeFlow({ message: "move my alarm to 8", now: NIGHT, exec: stub("Saved an alarm for Friday, 08:00, but the phone link on this Mac is not running, so the iPhone has not received it. Say so.").exec });
        expect(down).toMatchObject({ outcome: "say" });
        expect(down.text).toMatch(/8:00 AM.*hasn't received it/);
        const bad = await runWakeFlow({ message: "move my alarm to 8", now: NIGHT, exec: stub("usage: orion-wake HH:MM | clear", 2).exec });
        expect(bad.text).toMatch(/couldn't set your wake alarm/);
    });
    it("clear runs 'clear'; read runs bare; repeat runs nothing", async () => {
        const c = stub("Cleared. The phone goes back to the automatic wake-up.");
        expect(await runWakeFlow({ message: "clear my alarm", now: NIGHT, exec: c.exec })).toMatchObject({ outcome: "done", reply: "Your wake alarm is back to automatic." });
        expect(c.calls).toEqual([["clear"]]);
        const r = stub("Wake-up set for Fri, 12:00 (asked 2026-10-16T01:45:00.000Z).");
        expect(await runWakeFlow({ message: "what's my alarm", now: NIGHT, exec: r.exec })).toMatchObject({ outcome: "say", text: "Your wake alarm is set for Fri, 12:00." });
        expect(r.calls).toEqual([[]]);
        const none = stub("No manual wake-up; the phone uses the automatic one (first class minus get-ready time).");
        expect((await runWakeFlow({ message: "what's my alarm", now: NIGHT, exec: none.exec })).text).toMatch(/no manual wake alarm/i);
        const rep = stub();
        expect(await runWakeFlow({ message: "alarm for 6:45 weekdays", now: NIGHT, exec: rep.exec })).toMatchObject({ outcome: "say" });
        expect(rep.calls).toEqual([]);
    });
    it("not a wake request falls back", async () => {
        expect(await runWakeFlow({ message: "whats the weather", now: NIGHT, exec: stub().exec })).toMatchObject({ outcome: "fallback" });
    });
});
describe("routing: the reminder paths do not catch it", () => {
    it("his sentence runs the wake flow, with no alarm_set directive", async () => {
        const handlers = new Map();
        const api = { on: (n, fn) => handlers.set(n, [...(handlers.get(n) ?? []), fn]) };
        const fire = async (n, e, c) => { const out = []; for (const fn of handlers.get(n) ?? [])
            out.push(await fn(e, c)); return out; };
        const s = stub();
        let extracted = 0;
        registerLocalRouting(api, { warm: false, mode: "on", logPath: join(mkdtempSync(join(tmpdir(), "wk-")), "r.jsonl"), brainSearch: async () => "", clock: () => "Fri 01:45", now: () => NIGHT,
            decideImpl: async () => WAKE, scheduleFlow: async () => ({ outcome: "fallback", reason: "t" }),
            extractReminder: async () => { extracted += 1; return { time: "12:00", label: "push my alarm" }; },
            wakeFlow: (message, decision) => runWakeFlow({ message, ...(decision ? { decision } : {}), now: NIGHT, exec: s.exec }) });
        const ctx = { runId: "wk1", sessionKey: "agent:main:x" };
        await fire("before_model_resolve", { prompt: HIS }, ctx);
        const [built] = (await fire("before_prompt_build", { prompt: HIS, messages: [] }, ctx));
        expect(s.calls).toEqual([["12:00"]]);
        expect(extracted).toBe(0);
        expect(`${built?.systemPrompt}\n${built?.appendContext ?? ""}`).not.toMatch(/alarm_set/);
        expect(built?.systemPrompt).toContain("Your wake alarm is now 12:00 PM.");
    });
});
