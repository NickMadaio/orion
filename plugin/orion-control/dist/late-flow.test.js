import { describe, expect, it } from "vitest";
import { isBareYes, isLateConfirm, isLateWithoutMinutes, lateMinutesAnswer, runLateFlow, LATE_ASK } from "./late-flow.js";
// q029 (2026-10-16 r8): "im running late" → "like 15 min" → "yeah push everything after it".
const NOTHING_BOOKED = "NOTHING WAS BOOKED on Friday (2026-10-16). Do not tell him anything was added or moved.\nChanged Friday 2026-10-16:\n  rebuilt the remaining day from fixed commitments and must-haves first";
describe("late-flow parsing", () => {
    it("running late with no minutes is the ask", () => {
        for (const m of ["im running late", "I'm running a bit late", "gonna be late", "im late", "running late"])
            expect(isLateWithoutMinutes(m), m).toBe(true);
        for (const m of ["im running 15 late", "am i running late?", "i'm late to the lecture and i need to move dinner and the gym and also email prof", "going over my notes"])
            expect(isLateWithoutMinutes(m), m).toBe(false);
    });
    it("reads short minute answers", () => {
        const cases = [["like 15 min", 15], ["15", 15], ["about 20 minutes", 20], ["20m", 20], ["an hour", 60], ["half an hour", 30], ["fifteen", 15], ["yeah like 10 mins", 10], ["1 hour", 60], ["lol what", null], ["push everything after it", null]];
        for (const [said, n] of cases)
            expect(lateMinutesAnswer(said), said).toBe(n);
    });
    it("recognises the go-ahead", () => {
        expect(isLateConfirm("yeah push everything after it")).toBe(true);
        expect(isLateConfirm("push everything back")).toBe(true);
        expect(isLateConfirm("push the gym to 6")).toBe(false);
        expect(isBareYes("yeah")).toBe(true);
        expect(LATE_ASK).toMatch(/how many minutes/);
    });
});
describe("runLateFlow", () => {
    const stub = (stdout, code = 0) => { const calls = []; return { calls, exec: async (a) => { calls.push(a); return { stdout, code }; } }; };
    it("his exact NOTHING WAS BOOKED output is said plainly, never 'adjusted'", async () => {
        const s = stub(NOTHING_BOOKED);
        const flow = await runLateFlow({ minutes: 15, exec: s.exec });
        expect(s.calls).toEqual([["late", "15"]]);
        expect(flow).toMatchObject({ outcome: "say", kind: "plain" });
        const text = flow.text;
        expect(text).toBe("Nothing was moved — what's left today is classes and plans with fixed times, which don't slide.");
        expect(text).not.toMatch(/adjusted|pushed forward/i);
    });
    it("a refusal that names a block is said with its reason", async () => {
        const flow = await runLateFlow({ minutes: 20, exec: stub("NOTHING WAS CHANGED: must-haves could not fit: Study.", 1).exec });
        expect(flow.text).toMatch(/^I couldn't move your day|^Nothing was moved/);
    });
    it("a real move is done, from the scheduler's lines", async () => {
        const flow = await runLateFlow({ minutes: 15, exec: stub("Changed Friday 2026-10-16:\n  moved Study: 16:00 → 16:15\n  moved Gym: 17:00 → 17:15").exec, undoTop: (() => { let i = 0; return () => `t${i++}`; })() });
        expect(flow).toMatchObject({ outcome: "done", marks: ["t1"] });
        expect(flow.reply).toMatch(/Study now 4:15 PM/);
    });
    it("under 5 minutes is not run", async () => {
        const s = stub("x");
        expect(await runLateFlow({ minutes: 3, exec: s.exec })).toMatchObject({ outcome: "say" });
        expect(s.calls).toEqual([]);
    });
});
