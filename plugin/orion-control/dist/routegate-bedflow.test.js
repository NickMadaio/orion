import { describe, expect, it } from "vitest";
import { readSleepTurn } from "./sleep-plan-read.js";
import { runSleepTurn } from "./sleep-plan-flow.js";
const now = new Date(2026, 10, 4, 21, 57);
// A fake orion-sleepplan that answers as the real one does: an exact bedtime, with the read-back from wake-plan.json.
const script = (over = {}) => {
    const calls = [];
    const run = async (args) => {
        calls.push(args);
        const tonight = args.includes("--tonight");
        return { code: 0, stdout: JSON.stringify({ ok: true, was: "21:50", readback: { evening: "2026-11-04", sleepBy: "23:45", nudgeAt: "23:15", wake: "05:50", wakeDate: "2026-11-05", alarmAsked: true, hours: 6.08, lockdownBelowHours: 6, tonightOnly: tonight, standing: "00:00", ...over } }) };
    };
    return { run, calls };
};
describe("L1: push my bedtime to, um, eleven forty five", () => {
    it("is read as an exact bedtime for tonight, not refused", () => {
        expect(readSleepTurn("push my bedtime to, um, eleven forty five", { now })).toEqual({ kind: "bedset", change: { time: "23:45", scope: "tonight" } });
    });
    it("the reply is built from the read-back and says what moved with it", async () => {
        const { run, calls } = script();
        const turn = readSleepTurn("push my bedtime to, um, eleven forty five", { now });
        const out = await runSleepTurn(turn, { run, now });
        expect(calls[0]).toEqual(["bedtime", "23:45", "--tonight", "--json"]);
        expect(out.flow).toMatchObject({ outcome: "done" });
        const reply = out.flow.reply;
        expect(reply).toContain("Bedtime 11:45pm tonight.");
        expect(reply).toContain("Wind-down at 11:15pm");
        expect(reply).toContain("alarm still 5:50am");
        expect(reply).toContain("6h05 of sleep");
        expect(reply).not.toContain("lockdown"); // 6h05 is above the 6h line
    });
});
describe("L2: going to bed at eleven forty five", () => {
    it("is a tonight-only bedtime update with the read-back line, never a stale alarm", async () => {
        const said = "No. I took a really long nap, so I'm going to bed at eleven forty five.";
        const { run, calls } = script();
        const turn = readSleepTurn(said, { now });
        expect(turn).toEqual({ kind: "bedset", change: { time: "23:45", scope: "tonight" } });
        const out = await runSleepTurn(turn, { run, now });
        expect(calls[0]).toEqual(["bedtime", "23:45", "--tonight", "--json"]);
        expect(out.flow.reply).toMatch(/^Bedtime 11:45pm tonight\..*alarm still 5:50am/);
    });
});
describe("the same writer for every phrasing", () => {
    const cases = [
        ["push bedtime back 30 min", ["bedtime", "shift", "30", "--tonight", "--json"]],
        ["bed at quarter to 12", ["bedtime", "23:45", "--json"]],
        ["i want to sleep at 11 tonight", ["bedtime", "23:00", "--tonight", "--json"]],
        ["from now on bedtime 11", ["bedtime", "23:00", "--json"]],
        ["move my bedtime up half an hour", ["bedtime", "shift", "-30", "--tonight", "--json"]],
    ];
    it.each(cases)("%s", async (said, args) => {
        const { run, calls } = script();
        await runSleepTurn(readSleepTurn(said, { now }), { run, now });
        expect(calls[0]).toEqual(args);
    });
    it("every night says so, tonight-only offers to make it stick", async () => {
        const a = await runSleepTurn(readSleepTurn("from now on bedtime 11", { now }), { run: script().run, now });
        expect(a.flow.reply).toContain("every night from now on");
        const b = await runSleepTurn(readSleepTurn("i want to sleep at 11 tonight", { now }), { run: script().run, now });
        expect(b.flow.reply).toContain("every night");
    });
    it("under the lockdown line it says so", async () => {
        const out = await runSleepTurn(readSleepTurn("bed at 1", { now }) ?? readSleepTurn("make my bedtime 1 am", { now }), { run: script({ hours: 4.5 }).run, now });
        expect(out.flow.reply).toContain("under your 6h line");
    });
    it("a refusal carries the script's reason and never claims it changed", async () => {
        const run = async () => ({ code: 3, stdout: JSON.stringify({ ok: false, error: "a bedtime has to be between 8 PM and 4 AM" }) });
        const out = await runSleepTurn(readSleepTurn("make my bedtime 11:30 pm", { now }), { run, now });
        expect(out.flow).toMatchObject({ outcome: "say" });
        expect(out.flow.text).toContain("so it's as it was");
    });
});
describe("wake time, in his phrasing (w18 cases and the audit's)", () => {
    it.each([
        ["Push my wake up time to six AM", "06:00"], ["push my wake time to six thirty", "06:30"], ["change my alarm to 7", "07:00"], ["wake me at half 6 tomorrow", "06:30"],
        ["wake me up at quarter to seven tomorow", "06:45"],
    ])("%s", (said, time) => {
        const t = readSleepTurn(said, { now });
        expect(t).toMatchObject({ kind: "alarm", req: { kind: "set", time } });
    });
    it("no alarm tomorrow", () => {
        expect(readSleepTurn("no alarm tomorrow", { now })).toMatchObject({ kind: "alarm", req: { kind: "off", day: "tomorrow" } });
    });
    it("push the alarm back 30 min, and earlier", () => {
        expect(readSleepTurn("push my alarm back 30 min", { now })).toMatchObject({ kind: "alarm", req: { kind: "shift", minutes: 30 } });
        expect(readSleepTurn("move my alarm up half an hour", { now })).toMatchObject({ kind: "alarm", req: { kind: "shift", minutes: -30 } });
    });
});
