import { test } from "node:test";
import assert from "node:assert/strict";
import { nextAction } from "../scripts/lib/life/next-action.mjs";

const b = (id, kind, start, end, fixed = false) => ({ id, title: id, kind, date: "2026-09-29", start, end, fixed, source: "calendar" });
const day = [b("macro", "class", 810, 900, true), b("slides", "study", 600, 660), b("gym", "gym", 1080, 1140)];
test("late at night means sleep", () => assert.equal(nextAction({ blocks: day, now: 180, state: "awake_late" }).action, "sleep"));
test("the current block wins", () => assert.deepEqual(nextAction({ blocks: day, now: 820 }).blockId, "macro"));
test("a class in ten minutes means prepare", () => {
  const r = nextAction({ blocks: day, now: 800 }); assert.equal(r.action, "prepare"); assert.equal(r.startsIn, 10);
});
test("missed study comes back", () => {
  const r = nextAction({ blocks: day, now: 700 }); assert.equal(r.action, "do"); assert.equal(r.blockId, "slides");
  assert.match(r.reason, /10:00/);
});
test("done blocks are not suggested", () => assert.notEqual(nextAction({ blocks: day, now: 700, done: ["slides"] }).blockId, "slides"));
test("an empty evening is free", () => assert.deepEqual(nextAction({ blocks: day, now: 1200, done: ["slides"] }).reason, "Nothing else is planned today."));
