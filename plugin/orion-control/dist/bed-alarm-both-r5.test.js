// w20 round 5 (gate 3 #103): a wake time and a bedtime in one message, in either order, are both set and both read back.
import { describe, expect, it } from "vitest";
import { readSleepTurn } from "./sleep-plan-read.js";
import { runSleepTurn } from "./sleep-plan-flow.js";
import { wakeDateArg } from "./alarm-flow.js";
const THU_5AM = new Date(2026, 10, 5, 5, 17);
const THU_8PM = new Date(2026, 10, 5, 20, 0);
const fake = () => {
    const calls = [];
    const run = async (args) => {
        calls.push(args);
        if (args[0] === "wake-on")
            return { code: 0, stdout: JSON.stringify({ ok: true, changed: { date: args[2] }, days: [{ date: args[2], sleepBy: "23:00" }] }) };
        if (args[0] === "alarms")
            return { code: 0, stdout: JSON.stringify({ ok: true, phone: { state: "confirmed" }, link: { fresh: true } }) };
        return { code: 0, stdout: JSON.stringify({ ok: true, readback: { evening: "2026-11-05", sleepBy: args[1] ?? "00:00", nudgeAt: "23:30", wake: "07:00", wakeDate: "2026-11-06", alarmAsked: true, hours: 7, lockdownBelowHours: 6, tonightOnly: args.includes("--tonight"), standing: "00:00" } }) };
    };
    return { run, calls };
};
describe("wake first, bedtime second", () => {
    it.each([
        ["wake me at 7 tomorrow and bedtime tonight is midnight", "00:00", true],
        ["set an alarm for 7 tomorrow, and bed at 11 tonight", "23:00", true],
        ["wake me up at 7 then im going to bed at quarter to 12", "23:45", true],
        ["wake me at 7 tomorrow and change my bedtime to half 11", "23:30", false],
        ["wake me at 7 and bedtime ten to twelve tonight", "23:50", true],
        ["wake me at 7 tomorrow, bedtime tonight is midnight", "00:00", true],
    ])("%s", async (said, time, tonight) => {
        const turn = readSleepTurn(said, { now: THU_8PM });
        expect(turn?.kind).toBe("bedset");
        const { run, calls } = fake();
        const out = await runSleepTurn(turn, { run, now: THU_8PM });
        const bed = calls.find((c) => c[0] === "bedtime");
        expect(bed).toEqual(["bedtime", time, ...(tonight ? ["--tonight"] : []), "--json"]);
        expect(calls.some((c) => c[0] === "wake-on" && c.includes("07:00"))).toBe(true);
        expect(out.flow.outcome).toBe("done");
        const reply = out.flow.reply;
        expect(reply).toMatch(/Bedtime /);
        expect(reply).toMatch(/Alarm set for 7am/);
    });
    it("the old order still works", async () => {
        const turn = readSleepTurn("going to bed at 11:30, set an alarm for 7", { now: THU_8PM });
        expect(turn?.kind).toBe("bedset");
    });
});
describe("which day 'tomorrow' is in the small hours", () => {
    it("before 5 AM it is today's date; from 5 AM it is the next date", () => {
        expect(wakeDateArg("tomorrow", "07:00", new Date(2026, 10, 5, 1, 10))).toBe("2026-11-05");
        expect(wakeDateArg("tomorrow", "07:00", new Date(2026, 10, 5, 4, 30))).toBe("2026-11-05");
        expect(wakeDateArg("tomorrow", "07:00", THU_5AM)).toBe("2026-11-06");
        expect(wakeDateArg("tomorrow", "07:00", THU_8PM)).toBe("2026-11-06");
    });
});
