// Follow-ups to the calendar intent layer (review 2026-10-21): table rows for each, fixtures only (stub scheduler, no model).
import { describe, expect, it } from "vitest";
import { readIntent, type IntentMemory } from "./calendar-intent.js";
import { runScheduleFlow, type Day } from "./schedule-flow.js";
import { dayDiff, uncertainReply } from "./schedule-reply.js";

const at = (h: number, m = 0) => new Date(2030, 9, 3, h, m);
const read = (m: string, now: Date, last?: IntentMemory) => readIntent(m, { now, ...(last ? { last } : {}) });
const LAST: IntentMemory = { order: ["gym", "resume"], home: false, explicit: true };

describe("1. an end after midnight, from a start late today, is tonight after midnight (not 'already passed')", () => {
  it.each([
    ["put cs lab from now until 2am", at(23), "02:00"],
    ["put cs lab from now until 1:30 am", at(22, 40), "01:30"],
    ["put cs lab from now until 02:00", at(23), "02:00"],
    ["put cs lab from now until 2", at(23), "02:00"],
  ])("%j at %s", (m, now, when) => {
    expect(read(m, now)).toMatchObject({ intent: { verb: "add", items: [{ issue: { kind: "past-midnight", at: when } }] } });
  });
  it("is said plainly and nothing is booked", async () => {
    const day: Day = { date: "2030-10-03", now: "23:00", blocks: [] };
    const writes: string[][] = [];
    const r = await runScheduleFlow({ message: "put cs lab from now until 2am", clock: "x", now: at(23), ask: async () => null,
      exec: async (a) => { if (a[0] !== "show") writes.push(a); return { stdout: JSON.stringify(day), code: 0 }; } });
    expect(writes).toEqual([]);
    expect(r).toMatchObject({ outcome: "say", text: "2:00 AM is after midnight, and a block can't run into tomorrow, so I haven't booked cs lab. Say \"until 11:55 PM\" to book it until then." });
  });
  it.each([["put cs lab from now until 9:30 pm", at(21, 54), "21:30"], ["put cs lab from now until 2am", at(14), "02:00"]])("%j at %s has still passed", (m, now, when) => {
    expect(read(m, now)).toMatchObject({ intent: { items: [{ issue: { kind: "passed", at: when } }] } });
  });
});

describe("2. before 5 AM a small hour in the next few hours is this early morning, or asked", () => {
  it.each([
    ["put a walk at 5", at(2), { start: "05:00" }],
    ["put a walk at 4:30", at(2), { start: "04:30" }],
    ["put a walk at 3", at(2, 30), { start: "03:00" }],
    ["put a walk at 6", at(2), { issue: { kind: "ambiguous", choices: ["06:00", "18:00"] } }],
    ["put a walk at 5 tonight", at(2), { start: "17:00" }],
    ["put a walk at 5", at(12), { start: "17:00" }],
    ["put a walk at 1", at(2), { start: "13:00" }],
  ])("%j at %s", (m, now, want) => {
    expect(read(m, now)).toMatchObject({ intent: { verb: "add", day: "today", items: [want] } });
  });
});

describe("3. a crash or an unknown outcome: the day is read back, never 'nothing changed'", () => {
  const before: Day = { date: "2030-10-03", now: "16:00", blocks: [{ title: "Gym", start: "20:15", end: "21:45", fixed: false }] };
  const moved: Day = { ...before, blocks: [{ title: "Gym", start: "19:00", end: "20:30", fixed: false }, { title: "walk", start: "17:00", end: "17:45", fixed: false }] };
  it("dayDiff says what was added, moved and removed", () => {
    expect(dayDiff(before, moved)).toEqual(["Gym moved from 8:15 PM–9:45 PM to 7:00 PM–8:30 PM", "walk added at 5:00 PM–5:45 PM"]);
    expect(dayDiff(moved, before)).toEqual(["Gym moved from 7:00 PM–8:30 PM to 8:15 PM–9:45 PM", "walk (5:00 PM–5:45 PM) is gone"]);
  });
  it.each([
    [before, moved, /now differs from before: Gym moved from 8:15 PM–9:45 PM to 7:00 PM–8:30 PM; walk added at 5:00 PM–5:45 PM\. Say "undo"/],
    [before, before, /reads the same as before, but I can't be sure the change didn't go through/],
    [before, undefined, /couldn't compare your calendar with how it was, so it may have changed/],
    [undefined, moved, /couldn't compare/],
  ])("uncertainReply %#", (b, a, want) => {
    const text = uncertainReply(b as Day | undefined, a as Day | undefined);
    expect(text).toMatch(want);
    expect(text).not.toMatch(/nothing (?:on your day )?changed|^Done/i);
  });
  const run = async (message: string, crash: { stdout: string; code: number }, after = moved) => {
    let wrote = false;
    return runScheduleFlow({ message, clock: "x", now: at(16), ask: async () => ({ steps: [{ do: "move", what: "B1", to: "19:00" }] }),
      exec: async (a) => { if (a[0] === "show") return { stdout: JSON.stringify(wrote ? after : before), code: 0 }; wrote = true; return crash; } });
  };
  it.each([
    ["an empty crash (intent path)", "put a walk at 5", { stdout: "", code: 1 }],
    ["a kill with half a line (intent path)", "put a walk at 5", { stdout: "Changed Thursday 2030-10-03:\n  plann", code: 143 }],
    ["an empty crash (form path)", "move gym to 7 please, if it fits", { stdout: "", code: 1 }],
  ])("%s: what the calendar reads now, and undo", async (_l, m, crash) => {
    const r = await run(m, crash);
    expect(r).toMatchObject({ outcome: "done", uncertain: true, reply: expect.stringMatching(/stopped before it reported back\. Your calendar now differs from before: Gym moved/) });
  });
  it("a crash that left the day as it was says so, and that it cannot be sure", async () => {
    expect(await run("put a walk at 5", { stdout: "", code: 1 }, before)).toMatchObject({ uncertain: true, reply: expect.stringMatching(/reads the same as before, but I can't be sure/) });
  });
  it("a refusal with a non-zero exit is still a refusal, not unknown", async () => {
    const r = await run("put a walk at 5", { stdout: "NOTHING WAS CHANGED: walk (45 min) did not fit", code: 1 });
    expect(r).toMatchObject({ outcome: "say" });
  });
});

describe("4. trailing hedges are doubt, not an order", () => {
  it.each([
    "reschedule my day, gym first idek", "reschedule my day, gym first or smth", "reschedule my day, gym first or sth", "reschedule my day, gym first or something",
    "reschedule my day, gym first ish", "reschedule my day, gym first kinda?", "reschedule my day, gym first kinda", "reschedule my day, gym first idk tho",
    "reschedule my day, gym first sorta", "reschedule my day, gym first probably", "reschedule my day, gym first i think", "put a walk at 5 or smth", "put a walk at 5 idek",
  ])("%j", (m) => {
    expect(read(m, at(12))).toMatchObject({ refused: "doubt" });
  });
  it("'kinda' in the middle is not a hedge on the request (live #6 still fires)", () => {
    expect(read("ok so reschedule my day and put gym frist then whatevers left by priorty, im kinda tired tho", at(21))).toMatchObject({ intent: { verb: "replan" } });
  });
});

describe("5. a report about the past is never a follow-up", () => {
  it.each(["we did resume then gym", "i did resume before gym", "we went to gym then resume", "already did resume before gym", "we finished resume then gym", "resume was before gym"])("%j", (m) => {
    const r = read(m, at(20, 57), LAST);
    expect(r).not.toHaveProperty("intent");
  });
  it("the real follow-up still is one", () => {
    expect(read("actually do resume before gym", at(20, 57), LAST)).toMatchObject({ intent: { verb: "reorder" } });
  });
});
