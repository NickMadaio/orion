import { test } from "node:test";
import assert from "node:assert/strict";
import { commuteWalls, commuteBlocks } from "../scripts/lib/life/commute.mjs";
import { adjustForShortSleep } from "../scripts/lib/life/after-late-night.mjs";

const day = [
  { id: "sem", title: "CS1802 Seminar", kind: "class", date: "2026-09-30", start: 540, end: 630, fixed: true, source: "calendar" },
  { id: "lab", title: "CS2100 Lab", kind: "class", date: "2026-09-30", start: 660, end: 750, fixed: true, source: "calendar" },
];

test("commute walls sit before the first class and after the last", () => {
  assert.deepEqual(commuteWalls(day, { commuteMinutes: 30 }).map((w) => [w.start, w.end]), [[510, 540], [750, 780]]);
  assert.deepEqual(commuteWalls([], { commuteMinutes: 30 }), []);
});

test("the short-night nap waits until he is home (2026-09-30)", () => {
  const withCommute = [...day, ...commuteBlocks(day, { commuteMinutes: 30 })];
  const r = adjustForShortSleep(withCommute, { sleptMinutes: 240, wake: 480, window: { start: 480, end: 1440 } });
  const nap = r.blocks.find((b) => b.title === "Nap");
  assert.ok(nap.start >= 780, `nap at ${nap.start}`);
});

test("plans away from home get travel before and after", () => {
  const soccer = [{ id: "s", title: "soccer practice", kind: "other", date: "2026-10-01", start: 1020, end: 1140, fixed: true }];
  assert.deepEqual(commuteWalls(soccer, { commuteMinutes: 30 }).map((w) => [w.start, w.end]), [[990, 1020], [1140, 1170]]);
});

test("ORION's own blocks make no travel time, even one called a lab (2026-10-01)", () => {
  const lab = [{ id: "d", title: "DS lab", kind: "class", date: "2026-10-01", start: 728, end: 818, fixed: false, source: "orion" }];
  assert.deepEqual(commuteWalls(lab, { commuteMinutes: 30 }), []);
});

test("a long gap between classes means going home and back (2026-10-05)", () => {
  const monday = [
    { id: "a", title: "CS1800 Lecture", kind: "class", date: "2026-10-05", start: 660, end: 750, fixed: true, source: "calendar" },
    { id: "b", title: "CS2101 Lab", kind: "class", date: "2026-10-05", start: 930, end: 1020, fixed: true, source: "calendar" },
  ];
  const walls = commuteWalls(monday, { commuteMinutes: 45 }).map((w) => [w.start, w.end]);
  assert.ok(walls.some(([s, e]) => s === 750 && e === 795), JSON.stringify(walls));
  assert.ok(walls.some(([s, e]) => s === 885 && e === 930), JSON.stringify(walls));
  const r = adjustForShortSleep([...monday, ...commuteBlocks(monday, { commuteMinutes: 45 })],
    { sleptMinutes: 280, wake: 480, window: { start: 480, end: 1440 }, minimums: { nap: 75 } });
  const nap = r.blocks.find((b) => b.title === "Nap");
  assert.deepEqual([nap.start, nap.end], [795, 870]);
});

test("a short gap between classes stays on campus", () => {
  const two = [
    { id: "a", title: "Lecture", kind: "class", date: "2026-10-05", start: 540, end: 630, fixed: true, source: "calendar" },
    { id: "b", title: "Lecture 2", kind: "class", date: "2026-10-05", start: 660, end: 750, fixed: true, source: "calendar" },
  ];
  assert.equal(commuteWalls(two, { commuteMinutes: 45 }).length, 2);
});
