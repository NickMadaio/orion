import { test } from "node:test";
import assert from "node:assert/strict";
import { wakeOn, bedOn, nightMarkers } from "../scripts/lib/life/night.mjs";

const config = { usualWake: "09:00", bedtime: "00:00", sleepHours: 8, readyMinutes: 75, commuteMinutes: 30 };
const b = (title, start, end, extra = {}) => ({ title, start, end, fixed: true, source: "calendar", ...extra });
const days = {
  "2026-10-01": [b("CS1800 Lecture", 540, 630), b("Side project", 480, 540, { fixed: false, source: "orion" })],
  "2026-10-02": [b("CS2100 Lab", 480, 570)],
  "2026-10-03": [],
};
const blocksOf = (d) => days[d] ?? [];

test("wake is the first real commitment minus get-ready time, never ORION's own block", () => {
  assert.equal(wakeOn("2026-10-01", { blocksOf, config }), 540 - 75, "config says 75 here");
  assert.equal(wakeOn("2026-10-03", { blocksOf, config }), 540, "free day: usual wake");
});

test("a wake-up he asked for wins for that morning", () => {
  assert.equal(wakeOn("2026-10-01", { blocksOf, config, wakeRequest: { date: "2026-10-01", minute: 450 } }), 450);
});

test("asleep-by is bedtime, or earlier when tomorrow starts early enough to need it", () => {
  assert.equal(bedOn("2026-10-02", { blocksOf, config }), 1440, "Saturday free: midnight");
  // Friday 8:00 lab → wake 6:45 → asleep by 22:45 on Thursday.
  assert.equal(bedOn("2026-10-01", { blocksOf, config }), 1440 + 405 - 480);
});

test("a night out moves the asleep line to after it plus the trip home", () => {
  const out = { "2026-10-03": [b("Ministry of Sound with Sam", 1320, 1500)] };
  assert.equal(bedOn("2026-10-03", { blocksOf: (d) => out[d] ?? [], config }), 1530);
});

test("markers for a day", () => {
  assert.deepEqual(nightMarkers("2026-10-01", { blocksOf, config }), { date: "2026-10-01", wake: 465, bed: 1365 });
});

test("an afternoon nap alarm is not his wake-up (the 3:30 PM line, 2026-09-30)", () => {
  assert.equal(wakeOn("2026-10-01", { blocksOf, config, wakeRequest: { date: "2026-10-01", minute: 930 } }), 465);
});
