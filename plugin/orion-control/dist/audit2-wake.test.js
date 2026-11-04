// w18 audit2 (item E): his 11-03 22:30-22:40 wake-time sentences, with the time said in words as the voice transcript gave it.
import { describe, expect, it } from "vitest";
import { readAlarm } from "./alarm-read.js";
import { readSleepTurn } from "./sleep-plan-read.js";
const NIGHT = new Date(2026, 10, 3, 22, 39);
describe("a wake time said in words", () => {
    it.each([
        ["Push my wake up time to six AM.", "06:00"],
        ["push my wake time to six thirty", "06:30"],
        ["try and scratch that. Can you push my wake time to six thirty?", "06:30"],
        ["Alright. Can you instead push my wake time to six thirty instead of six?", "06:30"],
        ["can u move my alarm to seven fifteen pls", "07:15"],
        ["wake me up at half past six", "06:30"],
        ["set my alarm for quarter to seven", "06:45"],
        ["move my wake up time to six forty five", "06:45"],
        ["push my alarm to eight o'clock", "08:00"],
        ["set my alarm for six oh five", "06:05"],
        ["change my wake time to seven", "07:00"],
    ])("'%s' sets %s", (said, time) => {
        expect(readAlarm(said)).toMatchObject({ kind: "set", time });
    });
    it("the sleep-plan front reads it as an alarm turn too", () => {
        const turn = readSleepTurn("push my wake time to six thirty", { now: NIGHT });
        expect(JSON.stringify(turn)).toContain("06:30");
    });
    it.each(["what time is it", "i woke up at six thirty and felt great", "set a timer for six minutes", "remind me at six thirty to call mum", "my class is at six thirty pm tomorrow", "alarm for three thirty pm"])("'%s' is not a wake change", (said) => { expect(readAlarm(said, { hour: 23 })).toBeUndefined(); });
});
