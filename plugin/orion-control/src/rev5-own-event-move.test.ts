// REV5 MUST 1 + MUST 2 (2026-10-31): a class or a plan with people moves ONLY when his own message names that block as the thing he
// is moving. Everything else refuses: the form misreading, the worker's own exec, a block he only mentioned near a move.
import { describe, expect, it } from "vitest";
import { compile, type Day } from "./schedule-flow.js";
import { movesThisOne, overrunIsMove } from "./own-event-writes.js";
import { unnamedAnchorWrite } from "./anchor-write-guard.js";
import { FORM_PROMPT } from "./schedule-form-prompt.js";

const MKTG = { title: "MKTG2201", start: "13:30", end: "15:30", fixed: true, kind: "class" };
const DINNER = { title: "Dinner with Sam", start: "19:00", end: "20:00", fixed: true };
const WORKOUT = { title: "Workout", start: "17:00", end: "18:00", fixed: false, kind: "gym" };
const READING = { title: "Reading", start: "16:00", end: "17:00", fixed: false };
const day: Day = { date: "2026-11-02", now: "10:00", blocks: [MKTG, READING, WORKOUT, DINNER] };
const idOf = (b: { title: string }) => `B${day.blocks.indexOf(b as never) + 1}`;

describe("MUST 2: the fixed block must be the object of the move", () => {
  it.each([
    ["push workout to 6 and dinner after", DINNER],
    ["i was making dinner, moved my reading to 6", DINNER],
    ["marketing hw moved to 4pm", MKTG],
    ["move gym to 4 after marketing", MKTG],
    ["my roommate moved to boston, dinner is still on", DINNER],
  ])("%s → does not move %s", (message, block) => {
    expect(movesThisOne(message, block, day.blocks)).toBe(false);
    expect(compile({ do: "move", what: idOf(block), to: "18:00" }, day, message)).toHaveProperty("error");
  });

  it.each([
    ["move marketing to 2pm today", MKTG, "14:00"],
    ["push my dinner with sam to 8", DINNER, "20:00"],
    ["marketing got moved to 2:15", MKTG, "14:15"],
    ["mktg2201 is at 2 instead today", MKTG, "14:00"],
  ])("%s → moves it, flagged as named", (message, block, to) => {
    expect(movesThisOne(message, block, day.blocks)).toBe(true);
    expect(compile({ do: "move", what: idOf(block), to }, day, message)).toEqual({ args: ["move", block.title, "--to", to, "--named"] });
  });

  it("an overrun read as a move carries the flag too, and an unnamed one does not become a move", () => {
    expect(overrunIsMove("move my MKTG2201 class today from 1:30 to 2pm, its running late", MKTG, day.blocks)).toEqual(["move", "MKTG2201", "--to", "14:00", "--named"]);
    expect(overrunIsMove("marketing hw moved to 4pm", MKTG, day.blocks)).toBeUndefined();
  });
});

describe("MUST 1: the worker's own exec never moves a fixed block he did not name", () => {
  it.each([
    ["push workout to 6 and dinner after", ["move", "Dinner with Sam", "--to", "20:00", "--named"]],
    ["marketing hw moved to 4pm", ["move", "MKTG2201", "--to", "16:00"]],
    ["make room for a nap at 1", ["move", "MKTG2201", "--to", "14:00", "--named"]],
    ["make room for a nap at 1", ["resize", "MKTG2201", "60"]],
    ["clear the afternoon", ["drop", "Dinner with Sam"]],
  ])("%s / %j → refused", (message, args) => {
    expect(unnamedAnchorWrite(message, args, day.blocks)?.title).toBe(args[1]);
  });
  it("his own named move passes", () => {
    expect(unnamedAnchorWrite("move marketing to 2pm today", ["move", "MKTG2201", "--to", "14:00", "--named"], day.blocks)).toBeNull();
    expect(unnamedAnchorWrite("push my dinner with sam to 8", ["move", "Dinner with Sam", "--to", "20:00", "--named"], day.blocks)).toBeNull();
  });
});

describe("the form is taught the same rule", () => {
  it("a FIXED block is moved only when it is the thing he moves; one he only mentions, or homework for it, is not", () => {
    expect(FORM_PROMPT).toMatch(/FIXED block moves only when it is the thing he is moving/);
    expect(FORM_PROMPT).toMatch(/homework or study for a class is not the class/i);
  });
});
