import { describe, expect, it } from "vitest";
import { dayArgsFor, runScheduleFlow, type Day, type Intent } from "./schedule-flow.js";

// Live re-run 2026-10-16 (graded-rerun.json): four wrong writes. Whatever the 9B fills in, code must not write them.
const friday: Day = {
  date: "2026-10-16", now: "13:00",
  blocks: [
    { title: "MKTG2201 Introduction to Marketing — Lecture", start: "13:30", end: "15:00", fixed: true },
    { title: "lunch", start: "12:00", end: "12:30", fixed: false },
  ],
};

async function run(message: string, steps: Intent[], now = new Date(2026, 9, 16, 13, 0), day: Day = friday) {
  const calls: string[][] = [];
  const r = await runScheduleFlow({
    message, clock: "Fri 13:00", now,
    exec: async (a) => { calls.push(a); return { stdout: a[0] === "show" ? JSON.stringify(day) : "planned x: 15:05–15:25\n", code: 0 }; },
    ask: async () => ({ steps }),
  });
  return { r, writes: calls.filter((a) => a[0] !== "show") };
}

describe("a skip can never add (q019)", () => {
  for (const steps of [
    [{ do: "add", what: "gym", minutes: 20, to: "15:05" }],
    [{ do: "fill_between", what: "gym", after: "B2", before: "B1" }],
    [{ do: "plan", after: "B1", items: [{ title: "gym", minutes: 20 }] }],
  ] as Intent[][]) {
    it(`"skip gym today" with ${steps[0]!.do} writes nothing and says there is no gym`, async () => {
      const { r, writes } = await run("skip gym today", steps);
      expect(writes).toEqual([]);
      expect(r).toMatchObject({ outcome: "say", kind: "cannot", text: expect.stringMatching(/no gym/i) });
    });
  }
  it("a skip of a block that is there still works", async () => {
    const { writes } = await run("skip the lecture today", [{ do: "skip", what: "B1" }]);
    expect(writes).toEqual([["skip", "MKTG2201 Introduction to Marketing — Lecture"]]);
  });
  it("'skip lunch and add a walk' may add", async () => {
    const { writes } = await run("skip lunch and add a walk at 4", [{ do: "drop", what: "B2" }, { do: "add", what: "walk", minutes: 20, to: "16:00" }]);
    expect(writes.map((w) => w[0])).toEqual(["drop", "add"]);
  });
});

describe("tomorrow is never silently today (q020)", () => {
  const late = new Date(2026, 9, 16, 1, 11);
  it("before 5 AM 'tomorrow' is ambiguous: ask, write nothing", async () => {
    expect(dayArgsFor("add a 45 min block for resume work tomorrow after lunch", late)).toMatchObject({ args: [], ask: expect.stringMatching(/tomorrow/i) });
    const { r, writes } = await run("add a 45 min block for resume work tomorrow after lunch", [{ do: "add", what: "resume work", minutes: 45 }], late);
    expect(writes).toEqual([]);
    expect(r).toMatchObject({ outcome: "say", kind: "ask" });
  });
  it("in the daytime tomorrow compiles to --date tomorrow on every write", async () => {
    const { writes } = await run("add a 45 min block for resume work tomorrow", [{ do: "add", what: "resume work", minutes: 45 }], new Date(2026, 9, 16, 13, 0));
    expect(writes).toEqual([["add", "resume work", "45", "--date", "tomorrow"]]);
  });
});

describe("a contradiction asks, and never touches a block he did not name (q098)", () => {
  const msg = "cancel my lab and also make sure im in the lab at 2";
  it("asks before any form call or write", async () => {
    const { r, writes } = await run(msg, [{ do: "skip", what: "B1" }, { do: "add", what: "lab", minutes: 90, to: "14:00" }]);
    expect(writes).toEqual([]);
    expect(r).toMatchObject({ outcome: "say", kind: "ask", text: expect.stringMatching(/lab/i) });
  });
  it("a skip/drop of a block the message never names is refused", async () => {
    const { r, writes } = await run("cancel my lab", [{ do: "skip", what: "B1" }]);
    expect(writes).toEqual([]);
    expect(r).toMatchObject({ outcome: "say", kind: "cannot" });
  });
  it("a nickname still names it (DS = Discrete Structures, a course code)", async () => {
    const day: Day = { date: "2026-10-16", now: "08:00", blocks: [{ title: "CS1800 Discrete Structures — Lecture", start: "11:00", end: "12:30", fixed: true }] };
    for (const m of ["skip DS today", "skip cs1800 today", "skip discrete today"]) {
      const { writes } = await run(m, [{ do: "skip", what: "B1" }], new Date(2026, 9, 16, 8, 0), day);
      expect(writes).toEqual([["skip", "CS1800 Discrete Structures — Lecture"]]);
    }
  });
});

// Review 2026-10-16: the guard refused real swaps and claimed an existing block was missing.
describe("swaps are allowed; a refusal never says a block is missing when it is there (review MEDIUM)", () => {
  for (const msg of ["skip lunch, i'll go for a walk instead", "cancel lunch and do a run at 6 instead", "not going to lunch, study instead", "skip lunch, count a walk instead"]) {
    it(`"${msg}" may add`, async () => {
      const { writes } = await run(msg, [{ do: "drop", what: "B2" }, { do: "add", what: "walk", minutes: 20, to: "18:00" }]);
      expect(writes.map((w) => w[0])).toEqual(["drop", "add"]);
    });
  }
  it("refusal wording is 'I didn't make that change' and true when the block is on the day", async () => {
    const { r } = await run("skip lunch", [{ do: "add", what: "walk", minutes: 20, to: "18:00" }]);
    expect(r).toMatchObject({ text: expect.stringMatching(/^I didn't make that change/) });
    expect((r as any).text).not.toMatch(/no lunch/);
  });
  it("q019 still refuses and says there is no gym", async () => {
    const { r } = await run("skip gym today", [{ do: "add", what: "gym", minutes: 20, to: "15:05" }]);
    expect((r as any).text).toMatch(/^I didn't make that change.*no gym/i);
  });
  it("a time or an anchor names a block ('ditch the 4pm', 'drop whatever's after lab')", async () => {
    const day: Day = { date: "2026-10-16", now: "08:00", blocks: [
      { title: "CS2101 Lab", start: "10:00", end: "11:00", fixed: true }, { title: "study", start: "11:30", end: "12:30", fixed: false }, { title: "reading", start: "16:00", end: "17:00", fixed: false }] };
    const n = new Date(2026, 9, 16, 8, 0);
    expect((await run("ditch the 4pm", [{ do: "drop", what: "B3" }], n, day)).writes).toEqual([["drop", "reading"]]);
    expect((await run("ditch the 4 pm", [{ do: "drop", what: "B3" }], n, day)).writes).toEqual([["drop", "reading"]]);
    expect((await run("drop whatever's after lab", [{ do: "drop", what: "B2" }], n, day)).writes).toEqual([["drop", "study"]]);
  });
});

// Review round 3, 2026-10-16.
describe("skip-then-add of the same thing, a duration is not a time, an anchor is the adjacent block", () => {
  for (const [msg, steps] of [
    ["skip yoga today, i'll go tomorrow", [{ do: "add", what: "yoga", minutes: 30, to: "17:00" }]],
    ["skip yoga today, i'll do it tomorrow", [{ do: "fill_between", what: "yoga", after: "B2", before: "B1" }]],
    ["cancel my run, i'll rest instead", [{ do: "add", what: "run", minutes: 30, to: "17:00" }]],
  ] as Array<[string, Intent[]]>) {
    it(`"${msg}" adds nothing`, async () => {
      const { r, writes } = await run(msg, steps);
      expect(writes).toEqual([]);
      expect(r).toMatchObject({ outcome: "say", text: expect.stringMatching(/^I didn't make that change/) });
    });
  }
  const day: Day = { date: "2026-10-16", now: "08:00", blocks: [
    { title: "CS2101 Lab", start: "10:00", end: "11:00", fixed: true }, { title: "DS Lab", start: "14:00", end: "15:00", fixed: false },
    { title: "walk", start: "16:00", end: "16:30", fixed: false }, { title: "Study", start: "19:30", end: "21:30", fixed: false }] };
  const n = new Date(2026, 9, 16, 8, 0);
  it("'drop the 2 hour block' is not 2 PM", async () => {
    expect((await run("drop the 2 hour block", [{ do: "drop", what: "B2" }], n, day)).writes).toEqual([]);
    expect((await run("drop the 2 pm block", [{ do: "drop", what: "B2" }], n, day)).writes).toEqual([["drop", "DS Lab"]]);
  });
  it("'after lab' is only the first block after it", async () => {
    expect((await run("drop whatever's after lab", [{ do: "drop", what: "B4" }], n, day)).writes).toEqual([]);
    expect((await run("drop whatever's after lab", [{ do: "drop", what: "B2" }], n, day)).writes).toEqual([["drop", "DS Lab"]]);
  });
});
