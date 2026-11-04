// W18 wake: what he says about one morning's alarm. Held-out Nick-style phrasings (lowercase, typos, run-ons); none are in scripts/eval/gate/scenarios.
import { describe, expect, it } from "vitest";
import { minutesIn, morningTime, readAlarm } from "./alarm-read.js";
import { ownsSleepStatement, readSleepTurn } from "./sleep-plan-read.js";

const NIGHT = new Date(2026, 10, 4, 23, 10);
const AFTERNOON = new Date(2026, 10, 4, 15, 0);

describe("set: a time for one morning", () => {
  it.each([
    ["wake me up at 7 tomorrow", { kind: "set", time: "07:00", day: "tomorrow" }],
    ["yo wake me at 8 tmrw pls", { kind: "set", time: "08:00", day: "tomorrow" }],
    ["move my alarm to 6:45", { kind: "set", time: "06:45" }],
    ["can u set my alarm for 645", { kind: "set", time: "06:45" }],
    ["set an alarm for 9am thursday", { kind: "set", time: "09:00", day: "thu" }],
    ["change my alarm to 7.. actually 7:30", { kind: "set", time: "07:30" }],
    ["alarm at 6am tonight", { kind: "set", time: "06:00", day: "tomorrow" }],
    ["wake me up at 10 on saturday", { kind: "set", time: "10:00", day: "sat" }],
    ["need to be up at 5:30 so wake me then, set my alarm for 5:30", { kind: "set", time: "05:30" }],
  ])("'%s'", (said, req) => { expect(readAlarm(said)).toEqual(req); });

  it.each([
    "wake me up at 7 every weekday",
    "remind me at 7 to call mom",
    "set a timer for 20 min",
    "alarm in 20 minutes",
    "set an alarm for 3pm",
    "add gym at 7 tomorrow",
    "what should my alarm be for a 9am class",
    "going to bed, alarm is fine",
  ])("not '%s'", (said) => { expect(readAlarm(said, { hour: 23 })).toBeUndefined(); });
});

describe("off: no alarm one morning, or a standing no", () => {
  it.each([
    ["no alarm saturday", { kind: "off", day: "sat" }],
    ["skip my alarm tmrw", { kind: "off", day: "tomorrow" }],
    ["i dont need an alarm sunday", { kind: "off", day: "sun" }],
    ["dont wake me up tomorrow", { kind: "off", day: "tomorrow" }],
    ["cancel the alarm", { kind: "off" }],
    ["no alarms on weekends", { kind: "off", days: ["sat", "sun"] }],
    ["turn off my alarm every sunday", { kind: "off", days: ["sun"] }],
  ])("'%s'", (said, req) => { expect(readAlarm(said)).toEqual(req); });
});

describe("read: what alarm is set", () => {
  it.each([
    "what time is my alarm", "whats my alarm tmrw", "when am i waking up", "is my alarm set", "what alarms do i have", "tell me my alarm",
  ])("'%s'", (said) => { expect(readAlarm(said)).toEqual({ kind: "read" }); });
});

describe("shift: the next alarm later or earlier", () => {
  it.each([
    ["push it back 20 min", 20], ["push my alarm back half an hour", 30], ["move the alarm up 15", -15], ["bump it later by an hour", 60],
    ["pull my alarm forward 10 mins", -10], ["push the alarm back a couple hours", 120], ["push my alarm 45 min earlier", -45],
  ])("'%s'", (said, minutes) => { expect(readAlarm(said, { hour: 23 })).toEqual({ kind: "shift", minutes }); });

  it("a bare 'it' needs an alarm in play: said just before, or night; an explicit alarm never does", () => {
    expect(readAlarm("push it back 20 min", { hour: 15 })).toBeUndefined();
    expect(readAlarm("push it back 20 min", { hour: 15, recentAlarm: true })).toEqual({ kind: "shift", minutes: 20 });
    expect(readAlarm("push my alarm back 20 min", { hour: 15 })).toEqual({ kind: "shift", minutes: 20 });
  });
  it("needs a real amount", () => { expect(readAlarm("push my alarm back", { hour: 23 })).toBeUndefined(); expect(readAlarm("push it back 2", { hour: 23 })).toBeUndefined(); });
});

describe("pieces", () => {
  it("morning times only, 3 AM to noon", () => {
    expect(morningTime("at 7")).toBe("07:00"); expect(morningTime("for 645")).toBe("06:45"); expect(morningTime("at 7pm")).toBeUndefined();
    expect(morningTime("at 12")).toBe("12:00"); expect(morningTime("to 2")).toBeUndefined(); expect(morningTime("at 7 min")).toBeUndefined();
  });
  it("amounts", () => { expect(minutesIn("20 min")).toBe(20); expect(minutesIn("an hour")).toBe(60); expect(minutesIn("hour and a half")).toBe(90); expect(minutesIn("1h")).toBe(60); });
});

describe("the sleep reader owns them", () => {
  it("through readSleepTurn and ownsSleepStatement", () => {
    expect(readSleepTurn("wake me up at 7 tomorrow", { now: AFTERNOON })).toEqual({ kind: "alarm", req: { kind: "set", time: "07:00", day: "tomorrow" } });
    expect(readSleepTurn("push it back 20 min", { now: NIGHT })).toEqual({ kind: "alarm", req: { kind: "shift", minutes: 20 } });
    expect(readSleepTurn("push it back 20 min", { now: AFTERNOON })).toBeUndefined();
    expect(readSleepTurn("push it back 20 min", { now: AFTERNOON, recentAlarm: true })).toEqual({ kind: "alarm", req: { kind: "shift", minutes: 20 } });
    expect(ownsSleepStatement("no alarm saturday", { now: AFTERNOON })).toBe(true);
    expect(ownsSleepStatement("add gym tomorrow", { now: AFTERNOON })).toBe(false);
  });
  it("a standing statement still goes to the sleep plan, direct when it names a time and days", () => {
    expect(readSleepTurn("i want to start waking up at 7 on weekdays", { now: AFTERNOON })).toEqual({ kind: "interview", draft: { wake: "07:00", days: ["weekdays"], direct: true } });
    expect(readSleepTurn("wake me at 6 every weekday", { now: AFTERNOON })).toMatchObject({ kind: "interview", draft: { direct: true } });
  });
});
