// Wave 6 B (gate run-1101003318, hea-sleep-adjust-v): "slept like garbage, fix my day" asked for a 30-minute nap after the first
// class; the scheduler raised it to his 75-minute nap minimum and placed it at 13:20 (after the next class plus the commute). The
// reply said "30-minute nap at 10:30 AM after CS2100", which the calendar never held. The reply now comes from the day after the write.
import { describe, expect, it } from "vitest";
import { runLighten } from "./day-lighten.js";

const ADD_OUT = "Changed Tuesday 2026-11-03:\n  rebuilt the remaining day from fixed commitments and must-haves first\n  Nap 30 → 75 min (his minimum)\n  planned Nap: 13:20–14:35\nWritten to his calendar. \"orion-reschedule undo\" puts it back.";
const DROP_OUT = "Changed Tuesday 2026-11-03:\n  rebuilt the remaining day from fixed commitments and must-haves first\n  cleared 1 prior schedule block: Side project\nWritten to his calendar.";
const RENAME_OUT = "Changed Tuesday 2026-11-03:\n  Gym 17:00–18:30 is now \"Gym (easy)\" (same time)\nWritten to his calendar.";
const AFTER = JSON.stringify({ date: "2026-11-03", blocks: [
  { title: "CS2100", start: "09:00", end: "10:30", fixed: true, kind: "class" },
  { title: "ECON1115", start: "11:00", end: "12:30", fixed: true, kind: "class" },
  { title: "Nap", start: "13:20", end: "14:35", fixed: false, kind: "rest" },
  { title: "Gym (easy)", start: "17:00", end: "18:30", fixed: false, kind: "gym" },
] });
const steps = [
  { args: ["add", "Nap", "30", "--after", "CS2100"], said: "30-minute nap at 10:30 AM after CS2100" },
  { args: ["drop", "Side project"], said: "Side project off today" },
  { args: ["rename", "Gym", "Gym (easy)"], said: "Gym stays at 5:00 PM, as an easy session" },
];
const runner = (show: string | null) => {
  const calls: string[][] = [];
  const run = async (_s: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "show") return show === null ? { stdout: "", code: 1 } : { stdout: show, code: 0 };
    return { stdout: args[0] === "add" ? ADD_OUT : args[0] === "drop" ? DROP_OUT : RENAME_OUT, code: 0 };
  };
  return { calls, run };
};

describe("runLighten says what the calendar holds after the write", () => {
  it("names the nap the scheduler actually booked (length and time), not the planned one", async () => {
    const f = runner(AFTER);
    const out = await runLighten(steps, f.run as never);
    const reply = (out.flow as { reply: string }).reply;
    expect(reply).toMatch(/75-minute nap at 1:20 PM/);
    expect(reply).not.toMatch(/30-minute|10:30 AM|after CS2100/);
    expect(reply).toMatch(/minimum/i);
    expect(reply).toMatch(/Gym \(easy\)[^.]*5:00 PM/);
    expect(out.writes).toBe(3);
  });
  it("falls back to the scheduler's own 'planned' line when the day cannot be re-read", async () => {
    const f = runner(null);
    const out = await runLighten(steps, f.run as never);
    const reply = (out.flow as { reply: string }).reply;
    expect(reply).toMatch(/75-minute nap at 1:20 PM/);
    expect(reply).not.toMatch(/30-minute/);
  });
  it("a nap booked as planned keeps its plain wording", async () => {
    const day = JSON.stringify({ date: "2026-11-03", blocks: [{ title: "Nap", start: "10:30", end: "11:00", fixed: false, kind: "rest" }] });
    const run = async (_s: string, args: string[]) => (args[0] === "show" ? { stdout: day, code: 0 } : { stdout: "Changed:\n  planned Nap: 10:30–11:00\nWritten to his calendar.", code: 0 });
    const out = await runLighten([{ args: ["add", "Nap", "30", "--after", "CS2100"], said: "30-minute nap at 10:30 AM after CS2100" }], run as never);
    expect((out.flow as { reply: string }).reply).toMatch(/30-minute nap at 10:30 AM/);
  });
});
