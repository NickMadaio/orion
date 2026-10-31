// REV2 finding 2 (2026-10-31): "i just finished my coffee" logged a block called "I just" from 13:00 to now, and "the movie is over" /
// "dinner is done" said by the TV or the room logged blocks. A pronoun or adverb is not a block, and a finished thing is only written to
// his calendar when it matches a planned block.
import { describe, expect, it } from "vitest";
import { readReality, runReality } from "./reality.js";
import type { Day } from "./schedule-flow.js";

const now = new Date(2026, 9, 30, 14, 0);
const day: Day = { date: "2026-10-30", blocks: [
  { title: "Study for econ midterm", start: "13:00", end: "14:30", fixed: false, kind: "study" },
  { title: "Gym", start: "16:30", end: "18:00", fixed: false, kind: "gym" },
] } as Day;
const fake = () => { const calls: string[][] = []; return { calls, run: async (s: string, a: string[]) => { calls.push([s, ...a]); return { stdout: s === "orion-declare" ? '{"id":"f1"}' : "logged X\nWritten to his calendar.", code: 0 }; } }; };
const deps = (run: unknown, text: string) => ({ run: run as never, readDay: async () => day, now, source: "chat", text });

describe("finding 2: a pronoun or a thing not on his day is never logged", () => {
  it.each(["i just finished my coffee", "i literally just finished my coffee lol", "ok i finally finished it"])("%s reads no 'I just' block", (m) => {
    const r = readReality(m, now);
    if (r?.reality.kind === "done") expect(r.reality.what).not.toMatch(/\b(?:i|just|finally|literally|it)\b/);
  });
  it.each(["i just finished my coffee", "the movie is over", "dinner is done", "the game is over", "ok the show is finished"])("%s writes nothing to the calendar", async (m) => {
    const r = readReality(m, now);
    if (!r) return;
    const f = fake();
    const out = await runReality(r, deps(f.run, m));
    expect(f.calls.filter((c) => c[0] === "orion-reschedule")).toEqual([]);
    expect(out?.writes ?? 0).toBe(0);
  });
  it.each(["econ study is done", "finished the econ study", "gym done"])("%s still logs the planned block", async (m) => {
    const r = readReality(m, now)!;
    const f = fake();
    const out = await runReality(r, deps(f.run, m));
    expect(f.calls.some((c) => c[0] === "orion-reschedule" && c[1] === "log")).toBe(true);
    expect(out?.writes).toBeGreaterThan(0);
  });
});
