// Wave 6 (gate run-1101003318, loop-voice-cutoff-c): "move gym to right after marketing and then put side project at eight" is fully
// specified, but the intent layer read one change per sentence, so the worker asked "What time for Gym?". Two or three clauses are each
// read, planned against the day, and written as ONE `day --plan` call. Held-out phrasings do not appear in the gate scenarios.
import { describe, expect, it } from "vitest";
import { readIntent } from "./calendar-intent.js";
import { planIntent, runsFirst } from "./intent-run.js";
import { runScheduleFlow, type Day, type DayBlock } from "./schedule-flow.js";

const b = (title: string, start: string, end: string, fixed = false, kind?: string): DayBlock => ({ title, start, end, fixed, ...(kind ? { kind } : {}) });
const MON = (): Day => ({ date: "2026-11-02", now: "10:00", blocks: [b("MKTG2201", "13:30", "15:30", true, "class"), b("Gym", "17:00", "18:30", false, "gym"), b("Side project", "19:30", "20:30", false, "side_project")], plan: { commuteMinutes: 0, bufferMinutes: 5, anchors: [{ title: "Gym", minutes: 90 }] } });
const now = new Date(2026, 10, 2, 10, 0);
const plan = (said: string, day = MON()) => {
  const r = readIntent(said, { now });
  if (!("intent" in r)) return { read: r };
  return { intent: r.intent, first: runsFirst(r.intent), planned: planIntent(r.intent, day, { message: said }) };
};

describe("two changes in one sentence run together, in code", () => {
  it("the gate sentence: gym right after MKTG2201 (15:35, its own 90 min), side project at 8 PM, one call, no second gym", () => {
    const out = plan("move gym to right after marketing and then put side project at eight");
    expect(out.first).toBe(true);
    expect(out.planned).toEqual({ kind: "run", argv: ["day", "--plan", "Gym, 90, 15:35", "--plan", "Side project, 60, 20:00"], title: "Gym" });
  });
  it.each([
    ["shift gym to straight after mktg then move side project to 9", ["day", "--plan", "Gym, 90, 15:35", "--plan", "Side project, 60, 21:00"]],
    ["ok so push side project to 8pm and move gym to after marketing", ["day", "--plan", "Side project, 60, 20:00", "--plan", "Gym, 90, 15:35"]],
    ["move gym to after marketing, then put a 45 min walk at 7", ["day", "--plan", "Gym, 90, 15:35", "--plan", "walk, 45, 19:00"]],
    ["move gym to right after marketing and put side project right after gym", ["day", "--plan", "Gym, 90, 15:35", "--plan", "Side project, 60, 17:10"]],
  ])("held out: %s", (said, argv) => {
    const out = plan(said);
    expect(out.first).toBe(true);
    expect(out.planned).toEqual({ kind: "run", argv, title: argv[2]!.split(",")[0] });
  });
  it("a class named in a clause is never moved, and nothing else is written either", () => {
    expect(plan("move marketing to 4 and then put gym at 6").planned).toMatchObject({ kind: "say", say: "cannot" });
  });
  it("a clash with a class refuses the lot", () => {
    expect(plan("move gym to 2 and then put side project at 8").planned).toMatchObject({ kind: "say", text: expect.stringMatching(/^MKTG2201 is 1:30–3:30 PM, so Gym can't go at 2:00 PM/) });
  });
  it("a moved block that is not on the day is said, not invented", () => {
    expect(plan("move yoga to 3 and then put side project at 8").planned).toMatchObject({ kind: "say", text: expect.stringMatching(/^There's no yoga on your day/) });
  });
  it("one clause it cannot read: the whole sentence goes the normal way (no half-done write)", () => {
    expect(plan("move gym to right after marketing and then").read).toBeDefined();
    expect(plan("move gym to right after marketing and then do something fun").read).toBeDefined();
  });
  it("a single change is still the single-change shape", () => {
    const out = plan("move gym to 7");
    expect(out.intent?.verb).toBe("move");
  });
});

describe("through the schedule flow (the path the routing hands a code-first intent to)", () => {
  it("one write, no form, and the reply is the scheduler's", async () => {
    const writes: string[][] = []; let top = 0;
    const OUT = "Changed Monday 2026-11-02:\n  planned Gym: 15:35–17:05\n  planned Side project: 20:00–21:00\nWritten to his calendar. \"orion-reschedule undo\" puts it back.";
    const result = await runScheduleFlow({ message: "move gym to right after marketing and then put side project at eight", clock: "Mon 10:00", now, undoTop: () => `t${top}`,
      ask: async () => { throw new Error("the form must not be asked"); },
      exec: async (a) => { if (a[0] === "show") return { stdout: JSON.stringify(MON()), code: 0 }; writes.push(a); top += 1; return { stdout: OUT, code: 0 }; } });
    expect(writes).toEqual([["day", "--plan", "Gym, 90, 15:35", "--plan", "Side project, 60, 20:00"]]);
    expect(result.outcome).toBe("done");
  });
});
