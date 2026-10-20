// The pure parts of "Done early": what is current, which to-do it is, what the one line says.
import { test } from "node:test";
import assert from "node:assert/strict";
import { findCurrent, matchTodo, summaryLine, nothingLine, classLine, checkContext } from "../scripts/lib/life/done-early.mjs";
import { todoTag } from "../scripts/lib/life/todo-match.mjs";

const block = (o) => ({ id: "b", kind: "study", start: 840, end: 960, fixed: false, source: "orion", tags: [], ...o });
const todos = [{ identifier: "A1B2-C3D4", title: "Finish resume" }, { identifier: "E5", title: "Study for macro quiz" }, { identifier: "E6", title: "Study for DS quiz" }];

test("the block's own link wins over a title that looks like another to-do", () => {
  const linked = block({ title: "Study for macro quiz", tags: [todoTag("A1B2-C3D4")] });
  assert.equal(matchTodo(todos, linked).todo.title, "Finish resume");
});

test("a link whose to-do is already done matches nothing (never falls back to a lookalike)", () => {
  assert.deepEqual(matchTodo(todos, block({ title: "Study for macro quiz", tags: ["todo-gone"] })), { none: true, linked: true });
});

test("title match: the same title, or a whole title inside the other (two words at least); never a guess between two", () => {
  assert.equal(matchTodo(todos, block({ title: "finish RESUME" })).todo.identifier, "A1B2-C3D4");
  assert.equal(matchTodo(todos, block({ title: "Study for macro quiz — ch 4" })).todo.identifier, "E5");
  assert.deepEqual(matchTodo(todos, block({ title: "Study" })), { none: true });
  assert.equal(matchTodo(todos, block({ title: "Study for quiz" })).ambiguous.length, 2);
});

test("what is current: a task, an activity, a class, a pinned block; never a logged or a fixed plan with people", () => {
  const day = [
    { id: "c", title: "CS1802 Lecture", kind: "class", start: 540, end: 630, fixed: true, source: "calendar" },
    block({ id: "t", title: "Finish resume", start: 840, end: 960 }),
    block({ id: "g", title: "Gym", kind: "gym", start: 1080, end: 1140 }),
    { id: "d", title: "Dinner with friends", kind: "meal", start: 1200, end: 1260, fixed: true, source: "calendar" },
    block({ id: "p", title: "Nap", kind: "rest", start: 1300, end: 1400, fixed: true, pinned: true }),
  ];
  assert.equal(findCurrent(day, { now: 600 }).kind, "class");
  assert.equal(findCurrent(day, { now: 880 }).kind, "task");
  assert.equal(findCurrent(day, { now: 1100 }).kind, "activity");
  assert.equal(findCurrent(day, { now: 1220 }).kind, "none");
  assert.equal(findCurrent(day, { now: 1320 }).block.id, "p");
  assert.equal(findCurrent([{ ...day[1], logged: true }], { now: 880 }).kind, "none");
  assert.equal(findCurrent(day, { now: 840 }).kind, "none", "pressed the minute it starts: nothing has been done yet");
  assert.deepEqual(checkContext(findCurrent(day, { now: 880 })), { kind: "block", id: "t", title: "Finish resume", blockKind: "task" });
});

test("the one line", () => {
  assert.equal(summaryLine({ title: "Finish resume", ticked: "Finish resume", next: { title: "CS Lab", start: 1090 } }), "Nice — Finish resume is done and checked off. Next: CS Lab at 6:10 PM.");
  assert.equal(summaryLine({ title: "Gym", next: null }), "Nice — Gym is done. Nothing else is planned today.");
  assert.equal(summaryLine({ title: "Study", breakMinutes: 15, next: { title: "Side project", start: 900 } }), "Nice — Study is done. 15-min break, then Side project at 3:00 PM.");
  assert.match(summaryLine({ title: "Study", tickFailed: true, next: null }), /couldn't check off the to-do/);
  assert.match(nothingLine({ title: "CS Lab", start: 1090 }), /^Nothing is on right now\. Next up: CS Lab at 6:10 PM/);
  assert.match(classLine({ title: "DS", now: 600, freeFrom: 645, next: null }), /45 min reserved to get home/);
});
