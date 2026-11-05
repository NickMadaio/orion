import { describe, expect, it } from "vitest";
import { readBedtimeChange as r, readBedtimeWithAlarm } from "./bedtime-read.js";
import { readSleepTurn } from "./sleep-plan-read.js";
describe("readBedtimeChange, in his phrasing", () => {
    it("L1: push my bedtime to, um, eleven forty five", () => {
        expect(r("push my bedtime to, um, eleven forty five")).toEqual({ time: "23:45", scope: "tonight" });
        expect(r("Push my bedtime to eleven forty five pm")).toEqual({ time: "23:45", scope: "tonight" });
    });
    it("a plain set is every night; tonight and from-now-on words override", () => {
        expect(r("make my bedtime 11:30 pm")).toEqual({ time: "23:30", scope: "always" });
        expect(r("change my bed time to 11")).toEqual({ time: "23:00", scope: "always" });
        expect(r("from now on bedtime 11")).toEqual({ time: "23:00", scope: "always" });
        expect(r("set my bedtime to 12 tonight")).toEqual({ time: "00:00", scope: "tonight" });
        expect(r("change my bedtim to 12:30 from now on")).toEqual({ time: "00:30", scope: "always" });
    });
    it("spoken forms", () => {
        expect(r("bed at quarter to 12")).toEqual({ time: "23:45", scope: "tonight" });
        expect(r("set bedtime for half eleven")).toEqual({ time: "23:30", scope: "always" });
        expect(r("i want to sleep at 11 tonight")).toEqual({ time: "23:00", scope: "tonight" });
        expect(r("i wanna go to bed at one tonight")).toBeUndefined(); // a lone "one" is a word; the model asks
        expect(r("i wanna go to bed at 1 tonight")).toEqual({ time: "01:00", scope: "tonight" });
    });
    it("shifts", () => {
        expect(r("push bedtime back 30 min")).toEqual({ shift: 30, scope: "tonight" });
        expect(r("move my bedtime up half an hour")).toEqual({ shift: -30, scope: "tonight" });
        expect(r("bedtime later pls")).toEqual({ shift: 30, scope: "tonight" });
        expect(r("push my bedtime back an hour from now on")).toEqual({ shift: 60, scope: "always" });
        expect(r("bump bedtime earlier by 20 mins")).toEqual({ shift: -20, scope: "tonight" });
    });
    it("L2: going to bed at <time> is tonight's bedtime; past tense is a sleep log, not a change", () => {
        expect(r("No. I took a really long nap, so I'm going to bed at eleven forty five.")).toEqual({ time: "23:45", scope: "tonight" });
        expect(r("im going to bed at 11")).toEqual({ time: "23:00", scope: "tonight" });
        expect(r("sleeping at 11:30 tonight")).toEqual({ time: "23:30", scope: "tonight" });
        expect(r("gonna sleep at midnight")).toEqual({ time: "00:00", scope: "tonight" }); // w20 r4: midnight is a clock
        expect(r("i went to bed at 1 last night")).toBeUndefined();
        expect(r("slept at 3 lol")).toBeUndefined();
        expect(r("going to bed now")).toBeUndefined();
    });
    it("is not a bedtime change", () => {
        for (const s of ["what's my bedtime", "when is bedtime", "wake me at half 6 tomorrow", "i dont want a bedtime", "push my alarm to 7", "bedtime earlier", "i wanna sleep earlier this week", "push my bedtime to 6"])
            expect(r(s)).toBeUndefined();
    });
});
describe("w20 fix-sleep: a musing is tonight, only standing words change the standing bedtime", () => {
    it.each(["ill sleep at 1", "i think ill sleep at 1", "going to bed at 11", "gonna go to bed at 11 lol", "prob gonna sleep at 12", "bed at 1 i think"])("'%s' is tonight only", (said) => { expect(r(said)).toMatchObject({ scope: "tonight" }); });
    it.each([
        ["my bedtime is 11 now", "23:00"],
        ["change my bedtime to 11", "23:00"],
        ["from now on ill sleep at 12", "00:00"],
        ["i sleep at 1 every night now", "01:00"],
        ["set my bedtime to half 11 pls", "23:30"],
    ])("'%s' is every night", (said, time) => { expect(r(said)).toEqual({ time, scope: "always" }); });
    it.each(["go back to normal bedtime", "reset my bedtime", "back to my usual bed time pls", "clear my bedtime override lol"])("'%s' clears the fixed bedtime", (said) => { expect(r(said)).toEqual({ reset: true, scope: "always" }); });
    it("a reset is a bedtime turn for the sleep plan", () => {
        expect(readSleepTurn("reset my bedtime", { now: new Date(2026, 10, 3, 20, 0) })).toEqual({ kind: "bedset", change: { reset: true, scope: "always" } });
    });
});
describe("w20 fix-sleep: bedtime and alarm in one message", () => {
    it("takes the bedtime from the first clause and the alarm time from the alarm clause", () => {
        expect(readBedtimeWithAlarm("going to bed at 11:30, set an alarm for 7")).toEqual({ change: { time: "23:30", scope: "tonight" }, alarmText: "set an alarm for 7" });
        expect(readBedtimeWithAlarm("ill sleep at 12 and wake me at 8:30")?.change).toEqual({ time: "00:00", scope: "tonight" });
    });
    it("is not a compound when there is no alarm clause or the bedtime half is unreadable", () => {
        expect(readBedtimeWithAlarm("going to bed at 11")).toBeUndefined();
        expect(readBedtimeWithAlarm("set an alarm for 7")).toBeUndefined();
    });
    it("the sleep turn carries both halves", () => {
        const turn = readSleepTurn("going to bed at 11:30, set an alarm for 7", { now: new Date(2026, 10, 3, 20, 0) });
        expect(turn).toMatchObject({ kind: "bedset", change: { time: "23:30", scope: "tonight" }, alarm: { kind: "set", time: "07:00" } });
    });
});
