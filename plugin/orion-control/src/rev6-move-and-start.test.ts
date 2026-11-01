// Wave 4 review 4 and 5 (2026-11-01): a negated, conditional or questioned move is not him moving the event; and a focus start never
// takes its name from a plan with people, a fixed non-class event or the gym.
import { afterEach, describe, expect, it } from "vitest";
import { movesThisOne } from "./own-event-writes.js";
import { workStartTask } from "./work-start.js";
import { useCourseAliases } from "./block-names.js";
import type { DayBlock } from "./schedule-flow.js";

afterEach(() => useCourseAliases(undefined));
const MKTG: DayBlock = { title: "MKTG2201", start: "13:30", end: "15:30", fixed: true, kind: "class" };
const DINNER: DayBlock = { title: "Dinner with Sam", start: "19:00", end: "20:30", fixed: true };
const DAY = [MKTG, DINNER, { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" }];

describe("review 4: not a move he is making", () => {
  it.each([
    ["dont move marketing to 2", MKTG], ["don't move marketing to 2pm", MKTG], ["please do not push marketing to 3", MKTG], ["never move marketing to 2", MKTG],
    ["if marketing gets moved to 2 tell me", MKTG], ["if they move marketing to 2pm let me know", MKTG], ["in case marketing is moved to 3, remind me", MKTG],
    ["should i move dinner to 8", DINNER], ["can i push dinner with sam to 8?", DINNER], ["would it be better to move marketing to 2", MKTG], ["what if i move dinner to 8", DINNER],
  ])("%s", (m, block) => {
    useCourseAliases(new Map([["MKTG2201", ["marketing"]]]));
    expect(movesThisOne(m, block, DAY)).toBe(false);
  });
  it.each([["move marketing to 2pm", MKTG], ["push my dinner with sam to 8", DINNER], ["marketing got moved to 2", MKTG]])("still a move: %s", (m, block) => {
    useCourseAliases(new Map([["MKTG2201", ["marketing"]]]));
    expect(movesThisOne(m, block, DAY)).toBe(true);
  });
});

describe("review 5: no focus session named after a plan with people, a fixed event or the gym", () => {
  const known = [
    { title: "Dinner with Sam", start: "19:00", end: "20:30", fixed: true },
    { title: "Coffee w/ Priya", start: "16:00", end: "16:30", fixed: false },
    { title: "Dentist", start: "11:00", end: "11:30", fixed: true },
    { title: "Gym", start: "17:00", end: "18:30", fixed: false, kind: "gym" },
    { title: "ECON1115", start: "11:00", end: "12:30", fixed: true, kind: "class" },
    { title: "Zim brief" },
  ];
  it.each(["lets get started on sam", "ok lets work on priya", "lets get started on the dentist", "im gonna work on gym"])("%s", (m) => {
    expect(workStartTask(m, known)).toBeUndefined();
  });
  it("classes and deadlines still resolve", () => {
    expect(workStartTask("ok lets work on econ", known)).toBe("econ");
    expect(workStartTask("gonna knock out the zim brief", known)).toBe("the zim brief");
  });
});

describe("review 4: a request to ORION is still his move", () => {
  it.each(["can you move dinner to 8", "could u push dinner with sam to 8?"])("%s", (m) => expect(movesThisOne(m, DINNER, DAY)).toBe(true));
});
