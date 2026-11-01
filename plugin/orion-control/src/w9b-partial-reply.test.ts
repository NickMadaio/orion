// Wave 9 B: a run that only partly fits is worded like the compound replies (done, what could not happen, what was kept, undo),
// from the scheduler's own lines; a push that would cost the Gym its room is refused before anything is written.
import { describe, expect, it } from "vitest";
import { runScheduleFlow, spokenReply, type Day } from "./schedule-flow.js";
import { keptLine } from "./partial-reply.js";

const RUN = [
  "Changed Monday 2026-11-02:",
  "  rebuilt the remaining day from fixed commitments and must-haves first",
  "  cleared 2 prior schedule blocks: Gym, Side project",
  "  SHIFTED: Gym could not go at 18:00 (dinner with Annika is there) — booked 21:40 instead; tell him",
  "  planned Gym: 21:40–23:10",
  "  NOT BOOKED: Side project (60 min) did not fit on Monday — ask whether to drop it or put it on another day (--date YYYY-MM-DD)",
  'Written to his calendar. "orion-reschedule undo" puts it back.',
].join("\n");

const day: Day = { date: "2026-11-02", now: "10:00", plan: { commuteMinutes: 30, bufferMinutes: 10, anchors: [{ title: "Gym", minutes: 90 }] }, blocks: [
  { title: "MKTG2201", start: "13:30", end: "15:30", fixed: true, kind: "class" },
  { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" },
  { title: "dinner with Annika", start: "19:00", end: "21:00", fixed: true, kind: "other", nameable: true },
  { title: "Side project", start: "19:30", end: "20:30", fixed: false, kind: "side_project" },
] };

describe("partial reply", () => {
  it("the live sch-fixed-plan-protect run, in order, with what stayed put", () => {
    const text = spokenReply([RUN], undefined, keptLine(day.blocks, day.now));
    expect(text).toBe("Done — Gym couldn't go at 6:00 PM (dinner with Annika is there), so it's 9:40 PM–11:10 PM. But Side project didn't fit. Classes and dinner with Annika stay put. Say \"undo\" to revert.");
    expect(text).not.toMatch(/Partly done|Not done:|What did change|cleared/);
  });
  it("without a kept line it still reads in order", () => {
    expect(spokenReply(["Changed Sunday 2026-10-25:\n  planned Study: 13:05–14:05\n  NOT BOOKED: Laundry (60 min) did not fit on Sunday — ask"]))
      .toBe("Done — Study 1:05 PM–2:05 PM. But Laundry didn't fit. Say \"undo\" to revert.");
  });
  it("a block that was cleared and not put back is said as taken off, not as a change to what stayed", () => {
    const text = spokenReply(["Changed:\n  cleared 2 prior schedule blocks: Reading, Nap\n  planned Nap: 15:00–15:30\n  NOT BOOKED: Chores (30 min) did not fit on Friday — ask"], "Friday");
    expect(text).toBe("Done for Friday — Nap 3:00 PM–3:30 PM and took Reading off. But Chores didn't fit. Say \"undo\" to revert.");
  });
  it("a clean run keeps the kept line after what was done", () => {
    expect(spokenReply(["Changed:\n  planned Gym: 18:00–19:30"], undefined, "Classes stay put.")).toBe("Done: Gym 6:00 PM–7:30 PM. Classes stay put.");
  });
  it("keptLine: nothing fixed ahead says nothing; one plan reads singular; past ones are not named", () => {
    expect(keptLine([{ title: "Gym", start: "17:00", end: "18:30", fixed: false }], "10:00")).toBe("");
    expect(keptLine([{ title: "Dinner with Sam", start: "19:00", end: "20:00", fixed: true }], "10:00")).toBe("Dinner with Sam stays put.");
    expect(keptLine([{ title: "CS1800", start: "09:00", end: "10:30", fixed: true, kind: "class" }], "12:00")).toBe("");
  });
});

describe("push everything: the Gym is never what falls off", () => {
  const run = async (dryOut: string, writeOut: string) => {
    const calls: string[][] = [];
    const result = await runScheduleFlow({ message: "push everything back like an hour", clock: "x", now: new Date(2026, 10, 2, 10, 0), ask: async () => { throw new Error("no form"); },
      exec: async (a) => { calls.push(a); return { stdout: a[0] === "show" ? JSON.stringify(day) : a.includes("--dry-run") ? dryOut : writeOut, code: 0 }; } });
    return { result, calls };
  };
  it("a push that would leave no room for Gym writes nothing and says why", async () => {
    const { result, calls } = await run("NOTHING WAS BOOKED on Monday (2026-11-02).\nWould change:\n  NOT BOOKED: Gym (90 min) did not fit on Monday — ask", "SHOULD NOT RUN");
    expect(calls.filter((a) => a[0] === "day" && !a.includes("--dry-run"))).toEqual([]);
    expect(result).toMatchObject({ outcome: "say" });
    expect((result as { text: string }).text).toMatch(/no room for Gym before your wind-down.*haven't moved anything/);
  });
  it("a push that fits is written and the reply names what stayed put", async () => {
    const { result } = await run("Would change:\n  planned Gym: 18:00–19:30", "Changed:\n  planned Gym: 18:00–19:30\n  planned Side project: 20:30–21:30");
    expect((result as { reply?: string }).reply).toBe("Done: Gym 6:00 PM–7:30 PM; Side project 8:30 PM–9:30 PM. Classes and dinner with Annika stay put.");
  });
});
