// REV2 findings 9, 12 and 13 (2026-10-31): lightening the day from his words.
//  9  "im tired, cancel gym and side project" cut only gym; the side project was silently ignored.
// 12  "im stressed, cancel study tonight" suggested studying instead of doing what he said.
// 13  the people filter missed "Game night at Sam's" and "w/ Jess"; "Edit AE1 video" (coursework) read as the side project; a raw
//     substring match took "drop me" to Homework and "cut back" to Back workout.
import { describe, expect, it } from "vitest";
import { planLighten, readLighten } from "./day-lighten.js";
import type { Day } from "./schedule-flow.js";

const now = new Date(2026, 9, 30, 14, 0);
const day: Day = { date: "2026-10-30", blocks: [
  { title: "MKTG2201 Introduction to Marketing", start: "09:50", end: "11:30", fixed: true, kind: "class" },
  { title: "Study for econ midterm", start: "18:00", end: "19:00", fixed: false, kind: "study" },
  { title: "Gym", start: "16:30", end: "18:00", fixed: false, kind: "gym" },
  { title: "YouTube editing", start: "19:30", end: "20:30", fixed: false, kind: "side_project" },
  { title: "Laundry", start: "21:00", end: "21:30", fixed: false },
] } as Day;
const plan = (m: string, d: Day = day) => planLighten(readLighten(m)!, { day: d, now });
const drops = (m: string, d?: Day) => plan(m, d).steps.filter((s) => s.args[0] === "drop").map((s) => s.args[1]);

describe("finding 9: every cut he names is read, and one that isn't there is said", () => {
  it.each(["im tired, cancel laundry and side project", "im so tired, cut the laundry and the side project", "im wrecked, drop laundry & youtube"])("%s", (m) => {
    expect(drops(m)).toEqual(["Laundry", "YouTube editing"]);
  });
  it.each(["im tired, cancel laundry and piano", "im exhausted, drop piano and laundry", "so tired, cut piano and the laundry"])("%s names what isn't there", (m) => {
    const p = plan(m);
    expect(p.steps.map((s) => s.args[1])).toEqual(["Laundry"]);
    expect(p.text).toMatch(/Piano isn't on today's calendar/);
  });
  it.each(["im tired, cancel gym and laundry", "im exhausted, cut gym and the side project", "im wrecked, drop the gym and laundry"])("%s keeps gym, with pushback", (m) => {
    const p = plan(m);
    expect(p.steps.some((s) => s.args.includes("Gym"))).toBe(false);
    expect(p.steps.length).toBeGreaterThan(0);
    expect(p.text).toMatch(/Gym stays at 4:30 PM.*30 instead of 90|30 minutes instead of 90/);
  });
});
