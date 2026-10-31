// REV2 finding 18 (2026-10-31): a form misread falls back to the worker, which has orion-reschedule. The scheduler protects classes and
// plans with people but not gym or study: a worker write that drops or moves one he did not name is refused.
import { describe, expect, it } from "vitest";
import { unnamedAnchorWrite } from "./anchor-write-guard.js";
import type { DayBlock } from "./schedule-flow.js";

const blocks: DayBlock[] = [
  { title: "Study for econ midterm", start: "14:30", end: "16:00", fixed: false, kind: "study" },
  { title: "Gym", start: "16:30", end: "18:00", fixed: false, kind: "gym" },
  { title: "YouTube editing", start: "18:30", end: "19:30", fixed: false, kind: "side_project" },
  { title: "Laundry", start: "20:00", end: "20:45", fixed: false },
];
describe("finding 18: the worker never drops or moves an unnamed gym or study block", () => {
  it.each([
    ["clear some space tonight dude", ["drop", "Gym"]],
    ["make room for a nap at 4", ["move", "Study for econ midterm", "--to", "19:00"]],
    ["push the evening stuff later", ["drop", "--after", "Study for econ midterm"]],
    ["swap the laundry and editing", ["swap", "Laundry", "Gym"]],
  ])("%s -> %j is refused", (message, args) => {
    expect(unnamedAnchorWrite(message, args, blocks)).not.toBeNull();
  });
  it.each([
    ["move gym to 7", ["move", "Gym", "--to", "19:00"]],
    ["drop the econ study tonight", ["drop", "Study for econ midterm"]],
    ["bro cancel studying today", ["drop", "Study for econ midterm"]],
    ["drop the laundry", ["drop", "Laundry"]],
    ["swap laundry and youtube", ["swap", "Laundry", "YouTube editing"]],
  ])("%s -> %j runs", (message, args) => {
    expect(unnamedAnchorWrite(message, args, blocks)).toBeNull();
  });
});
