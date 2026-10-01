import { strict as assert } from "node:assert";
import { test } from "node:test";
import { reviewDay } from "../scripts/lib/life/day-review.mjs";

test("counts done against planned", () => {
  const blocks = [
    { title: "Study math", kind: "study", start: 480, end: 600, fixed: false, source: "orion" },
    { title: "Write report", kind: "work", start: 660, end: 780, fixed: false, source: "orion" },
    { title: "Gym session", kind: "gym", start: 900, end: 1020, fixed: true, source: "orion" },
  ];
  const checkins = [
    { what: "Studying math problems", dueMinute: 480, startedMinute: 490, doneMinute: 600, phase: "done" },
    { what: "Writing the report", dueMinute: 660, startedMinute: 670, doneMinute: 780, phase: "done" },
    { what: "Gym workout", dueMinute: 900, startedMinute: 910, doneMinute: null, phase: "waiting" },
  ];
  const todosDone = [];
  const now = { date: "2026-09-30", minute: 1200 };

  const result = reviewDay({ date: "2026-09-30", blocks, checkins, todosDone, now });

  assert.strictEqual(result.planned, 3);
  assert.strictEqual(result.done, 2);
  assert.deepStrictEqual(result.slipped, ["Gym session"]);
});

test("a to-do ticked off counts as done", () => {
  const blocks = [
    { title: "Fix Orion stuff", kind: "work", start: 480, end: 600, fixed: false, source: "orion" },
  ];
  const checkins = [];
  const todosDone = ["fix orion stuff"];
  const now = { date: "2026-09-30", minute: 700 };

  const result = reviewDay({ date: "2026-09-30", blocks, checkins, todosDone, now });

  assert.strictEqual(result.planned, 1);
  assert.strictEqual(result.done, 1);
  assert.deepStrictEqual(result.slipped, []);
});

test("slipped lists up to three", () => {
  const blocks = [
    { title: "Study math", kind: "study", start: 480, end: 600, fixed: false, source: "orion" },
    { title: "Write report", kind: "work", start: 660, end: 780, fixed: false, source: "orion" },
    { title: "Gym session", kind: "gym", start: 900, end: 1020, fixed: true, source: "orion" },
    { title: "Read book", kind: "study", start: 1080, end: 1200, fixed: false, source: "orion" },
    { title: "Call mom", kind: "personal", start: 1260, end: 1320, fixed: false, source: "orion" },
  ];
  const checkins = [];
  const todosDone = [];
  const now = { date: "2026-09-30", minute: 1400 };

  const result = reviewDay({ date: "2026-09-30", blocks, checkins, todosDone, now });

  assert.strictEqual(result.planned, 5);
  assert.strictEqual(result.done, 0);
  assert.deepStrictEqual(result.slipped, [
    "Study math",
    "Write report",
    "Gym session",
    "Read book",
    "Call mom",
  ]);
  // Text should list up to 3 with "and N more"
  assert.ok(result.text.includes("Slipped:"));
  assert.ok(result.text.includes("Study math"));
  assert.ok(result.text.includes("Write report"));
  assert.ok(result.text.includes("Gym session"));
  assert.ok(result.text.includes("and 2 more"));
});

test("lateness is the median start delay", () => {
  const blocks = [
    { title: "Study math", kind: "study", start: 480, end: 600, fixed: false, source: "orion" },
    { title: "Write report", kind: "work", start: 660, end: 780, fixed: false, source: "orion" },
    { title: "Gym session", kind: "gym", start: 900, end: 1020, fixed: true, source: "orion" },
  ];
  const checkins = [
    { what: "Studying math", dueMinute: 480, startedMinute: 500, doneMinute: 600, phase: "done" },
    { what: "Writing report", dueMinute: 660, startedMinute: 670, doneMinute: 780, phase: "done" },
    { what: "Gym workout", dueMinute: 900, startedMinute: 930, doneMinute: 1020, phase: "done" },
  ];
  const todosDone = [];
  const now = { date: "2026-09-30", minute: 1200 };

  const result = reviewDay({ date: "2026-09-30", blocks, checkins, todosDone, now });

  // Delays: 20, 10, 30 → sorted: 10, 20, 30 → median is 20
  assert.strictEqual(result.lateMinutes, 20);
});

test("rest and wind down are not work", () => {
  const blocks = [
    { title: "Study math", kind: "study", start: 480, end: 600, fixed: false, source: "orion" },
    { title: "Rest break", kind: "rest", start: 600, end: 630, fixed: false, source: "orion" },
    { title: "Wind down", kind: "personal", start: 1320, end: 1400, fixed: false, source: "orion" },
    { title: "Break", kind: "personal", start: 780, end: 810, fixed: false, source: "orion" },
  ];
  const checkins = [];
  const todosDone = [];
  const now = { date: "2026-09-30", minute: 1400 };

  const result = reviewDay({ date: "2026-09-30", blocks, checkins, todosDone, now });

  assert.strictEqual(result.planned, 1);
  assert.strictEqual(result.done, 0);
});

test("nothing planned", () => {
  const blocks = [];
  const checkins = [];
  const todosDone = [];
  const now = { date: "2026-09-30", minute: 1200 };

  const result = reviewDay({ date: "2026-09-30", blocks, checkins, todosDone, now });

  assert.strictEqual(result.planned, 0);
  assert.strictEqual(result.done, 0);
  assert.deepStrictEqual(result.slipped, []);
  assert.strictEqual(result.lateMinutes, null);
  assert.strictEqual(result.text, "Nothing was planned today.");
});

test("tomorrow line when given", () => {
  const blocks = [
    { title: "Study math", kind: "study", start: 480, end: 600, fixed: false, source: "orion" },
  ];
  const checkins = [
    { what: "Studying math", dueMinute: 480, startedMinute: 490, doneMinute: 600, phase: "done" },
  ];
  const todosDone = [];
  const now = { date: "2026-09-30", minute: 700 };
  const tomorrowFirst = { title: "Morning class", minute: 480 };

  const result = reviewDay({ date: "2026-09-30", blocks, checkins, todosDone, now, tomorrowFirst });

  assert.ok(result.text.includes("Tomorrow starts with Morning class at 8:00 AM."));
});

test("invalid input throws", () => {
  assert.throws(() => {
    reviewDay({ date: "", blocks: [], checkins: [], todosDone: [], now: { date: "2026-09-30", minute: 1200 } });
  }, TypeError);

  assert.throws(() => {
    reviewDay({ date: "2026-09-30", blocks: "not an array", checkins: [], todosDone: [], now: { date: "2026-09-30", minute: 1200 } });
  }, TypeError);

  assert.throws(() => {
    reviewDay({ date: "2026-09-30", blocks: [], checkins: [], todosDone: [], now: null });
  }, TypeError);
});
