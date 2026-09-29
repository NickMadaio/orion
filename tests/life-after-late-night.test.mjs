import { test } from "node:test";
import assert from "node:assert/strict";
import { adjustForShortSleep } from "../scripts/lib/life/after-late-night.mjs";

const b = (id, kind, start, end, fixed = false) => ({ id, title: id, kind, date: "2026-09-30", start, end, fixed, source: "calendar" });
const day = [b("seminar", "class", 540, 630, true), b("study", "study", 480, 540), b("lab", "class", 660, 750, true), b("sp", "side_project", 1200, 1260)];
const opts = (slept) => ({ sleptMinutes: slept, wake: 450, window: { start: 450, end: 1380 } });

test("a full night changes nothing", () => assert.deepEqual(adjustForShortSleep(day, opts(480)).changes, []));
test("classes stay where they are", () => {
  const r = adjustForShortSleep(day, opts(250));
  assert.equal(r.blocks.find((x) => x.id === "seminar").start, 540);
  assert.equal(r.blocks.find((x) => x.id === "lab").start, 660);
});
test("a nap follows the first class after noon", () => {
  const r = adjustForShortSleep(day, opts(330));
  const nap = r.blocks.find((x) => x.title === "Nap");
  assert.equal(nap.start, 750); assert.equal(nap.end - nap.start, 30);
});
test("very short nights get a longer nap", () => {
  const nap = adjustForShortSleep(day, opts(250)).blocks.find((x) => x.title === "Nap");
  assert.equal(nap.end - nap.start, 45);
});
test("early heavy work moves later", () => {
  const r = adjustForShortSleep(day, opts(250));
  assert.ok(r.blocks.find((x) => x.id === "study").start >= 570);
});
test("every change is reported", () => {
  const r = adjustForShortSleep(day, opts(250));
  assert.ok(r.changes.some((c) => c.startsWith("Added a 45 min nap at 12:30")));
  assert.ok(r.changes.some((c) => c.startsWith("Moved study to ")));
});
