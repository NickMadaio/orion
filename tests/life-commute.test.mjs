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
