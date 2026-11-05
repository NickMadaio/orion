// w20 round 5 (gate 3 #62): spoken amounts for an alarm shift. "another quarter of an hour" is 15 minutes, never an hour.
import { describe, expect, it } from "vitest";
import { minutesIn, readAlarm } from "./alarm-read.js";
describe("minutesIn, spoken fractions of an hour", () => {
    it.each([
        ["actually push it back another quarter of an hour", 15], ["push my alarm back a quarter hour", 15], ["move it later by a quarter of an hour", 15],
        ["push it back a quarter of an hour", 15], ["bump it another 15 mins", 15], ["push it back three quarters of an hour", 45], ["push it back an hour and a quarter", 75],
        ["push it back half an hour", 30], ["push it back another hour", 60], ["push it back a quarter", 15],
    ])("%s", (said, minutes) => { expect(minutesIn(said)).toBe(minutes); });
    it("reads as an alarm shift of 15 for the exact gate wording", () => {
        expect(readAlarm("actually push it back another quarter of an hour", { recentAlarm: true })).toEqual({ kind: "shift", minutes: 15 });
        expect(readAlarm("move my alarm up a quarter of an hour", { recentAlarm: true })).toEqual({ kind: "shift", minutes: -15 });
    });
});
describe("the complete duration table", () => {
    const table = [
        ["push it back an hour and a half", 90], ["push it back hour and a half", 90], ["push it back an hour and a quarter", 75], ["push it back hour and a quarter", 75],
        ["push it back two and a half hours", 150], ["push it back two and a quarter hours", 135], ["push it back one and a half hours", 90], ["push it back three and a quarter hours", 195],
        ["push it back three quarters of an hour", 45], ["push it back half an hour", 30], ["push it back half hour", 30], ["push it back a quarter of an hour", 15],
        ["push it back quarter of an hour", 15], ["push it back a quarter hour", 15], ["push it back 90 mins", 90], ["push it back 90 minutes", 90],
        ["push it back 1.5h", 90], ["push it back 1.5 hours", 90], ["push it back 2.25 hours", 135], ["push it back 1h15", 75], ["push it back 1h 15", 75], ["push it back 2h30", 150],
        ["push it back an hour 15", 75], ["push it back an hour and 20 mins", 80], ["push it back 1 hour 20 minutes", 80], ["push it back 2 hours", 120], ["push it back an hour", 60],
        ["push it back 20 min", 20], ["push it back a couple hours", 120], ["push it back 45 minutes", 45],
    ];
    it.each(table)("%s", (said, minutes) => { expect(minutesIn(said)).toBe(minutes); });
    it("a quarter that is not a length is not a duration", () => {
        expect(minutesIn("push it back a quarter of the way")).toBeUndefined();
        expect(minutesIn("push it back a quarter to the end")).not.toBe(15); // "quarter to/past" is a clock, never 15 minutes
    });
});
