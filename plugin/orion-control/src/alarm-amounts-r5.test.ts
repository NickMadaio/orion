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
