// Wave 9 B: "am i free <named day / part of day>" is read from that day's calendar by code and answered from it.
import { describe, expect, it } from "vitest";
import { answerAvailability, availabilityReply, readAvailability } from "./availability-read.js";
import type { Day } from "./schedule-flow.js";

const MON = new Date(2026, 10, 2, 21, 29);   // a Monday night
const blk = (title: string, start: string, end: string, extra: Partial<Day["blocks"][number]> = {}) => ({ title, start, end, fixed: false, ...extra });
const sparse: Day = { date: "2026-11-07", now: null, blocks: [blk("Gym", "17:00", "18:30", { kind: "gym" }), blk("Side project", "19:30", "20:30", { kind: "side_project" })] };
const busy: Day = { date: "2026-11-06", now: null, blocks: [
  blk("MKTG2201 — Lecture", "13:30", "15:30", { fixed: true, kind: "class" }), blk("Gym", "17:00", "18:30", { kind: "gym" }),
  blk("dinner with Annika", "19:00", "21:00", { fixed: true }), blk("Side project", "21:15", "22:15", { kind: "side_project" })] };
const empty: Day = { date: "2026-11-08", now: null, blocks: [] };

describe("which messages are availability questions", () => {
  it.each([
    ["am i free sat night", "Saturday night", "saturday"],
    ["anything on thursday afternoon", "Thursday afternoon", "thursday"],
    ["do i have stuff friday evening", "Friday evening", "friday"],
    ["r we free on saturday mornin?", "Saturday morning", "saturday"],
    ["u know if im busy tmrw evening", "tomorrow evening", "tomorrow"],
    ["hey whats on for sunday", "Sunday", "sunday"],
    ["is wednesday afternoon open", "Wednesday afternoon", "wednesday"],
    ["have i got anything on fri night", "Friday night", "friday"],
  ])("%j", (text, label, arg) => {
    const r = readAvailability(text, MON);
    expect(r?.label).toBe(label);
    expect(r?.dateArgs.at(-1)).toBe(arg);
  });
  it("his own weekday is today, tonight is today's evening", () => {
    expect(readAvailability("am i free monday evening", MON)).toMatchObject({ dateArgs: [], label: "this evening", today: true });
    expect(readAvailability("am i free later tonight", MON)).toMatchObject({ dateArgs: [], label: "tonight", today: true });
    expect(readAvailability("am i free next monday evening", MON)?.dateArgs).toEqual(["--date", "monday"]);
  });
  it.each([
    "move gym to saturday evening", "put a nap on friday afternoon", "cancel everything on thursday", "book 2 hours of econ saturday",
    "do i have time for a nap saturday afternoon", "whats due friday", "do i have anything due thursday", "when does the gym close saturday",
    "i sat on the couch all day", "am i free", "how long is my lab on thursday", "will it rain saturday evening", "thanks that was sunday",
  ])("%j is not one", (text) => expect(readAvailability(text, MON)).toBeUndefined());
});

describe("the answer is built from the day that was read", () => {
  it("a sparse day with only his own blocks in the window", () => {
    const a = readAvailability("am i free sat evening", MON)!;
    expect(availabilityReply(a, sparse, MON)).toBe("Nothing fixed Saturday evening. Just Gym, 5:00 PM–6:30 PM and Side project, 7:30 PM–8:30 PM, which are blocks of mine, so I can move them if you want the time.");
  });
  it("a busy day names what is fixed first", () => {
    const a = readAvailability("do i have stuff friday evening", MON)!;
    expect(availabilityReply(a, busy, MON)).toBe("Not completely. Friday evening you have dinner with Annika, 7:00 PM–9:00 PM, plus Gym, 5:00 PM–6:30 PM and Side project, 9:15 PM–10:15 PM of mine, which I can move.");
  });
  it("the window is the part of the day only", () => {
    expect(availabilityReply(readAvailability("anything on friday afternoon", MON)!, busy, MON)).toBe("Not completely. Friday afternoon you have MKTG2201, 1:30 PM–3:30 PM.");
    expect(availabilityReply(readAvailability("am i free friday morning", MON)!, busy, MON)).toBe("Yes, you're free Friday morning. Nothing is on your calendar then.");
  });
  it("an empty day is free", () => {
    expect(availabilityReply(readAvailability("whats on sunday", MON)!, empty, MON)).toBe("Yes, you're free Sunday. Nothing is on your calendar then.");
  });
  it("a part of today that is over says so", () => {
    expect(availabilityReply(readAvailability("anything on monday morning", MON)!, busy, MON)).toMatch(/already over/);
  });
});

describe("the route", () => {
  it("reads the named day and answers; never claims it has no calendar", async () => {
    const asked: string[][] = [];
    const text = await answerAvailability("orion are we free sat evening, jo wants to do something", MON, async (a) => { asked.push(a); return sparse; });
    expect(asked).toEqual([["--date", "saturday"]]);
    expect(text).toMatch(/^Nothing fixed Saturday evening/);
    expect(text).not.toMatch(/don't have|can't see|calendar app/i);
  });
  it("a failed read is a failed read, not a missing calendar", async () => {
    const text = await answerAvailability("am i free thursday night", MON, async () => undefined);
    expect(text).toBe("I couldn't read your calendar for Thursday just now, so I can't say if you're free. Try me again in a moment.");
  });
  it("a message that is not an availability question reads nothing", async () => {
    let reads = 0;
    expect(await answerAvailability("move gym to friday evening", MON, async () => { reads += 1; return busy; })).toBeUndefined();
    expect(reads).toBe(0);
  });
});
