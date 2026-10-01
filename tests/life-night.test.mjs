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

// 2026-10-01 (all times BST = UTC+1 in the fixtures' local zone): to bed 00:53,
// phone on the charger at 06:34, unplugged 06:42.
import { actualWake, actualSleep } from "../scripts/lib/life/night.mjs";
const at = (date, h, m) => new Date(`${date}T${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:00`).toISOString();

test("WHOOP's end of sleep is when he woke", () => {
  const nights = [{ fellAsleep: at("2026-10-01", 1, 5), wokeAt: at("2026-10-01", 6, 31), source: "whoop" }];
  assert.deepEqual(actualWake("2026-10-01", { nights }), { minute: 391, source: "whoop" });
  assert.deepEqual(actualSleep("2026-09-30", { nights }), { minute: 1440 + 65, source: "whoop" });
});

test("without WHOOP, the phone: unplugged after bed, not just charging", () => {
  const sleepLog = [{ event: "bed", at: at("2026-10-01", 0, 53) }];
  const phoneSignals = [{ at: at("2026-10-01", 6, 34), charging: true, motion: "unknown" }, { at: at("2026-10-01", 6, 42), charging: false, motion: "still" }];
  assert.deepEqual(actualWake("2026-10-01", { sleepLog, phoneSignals }), { minute: 402, source: "phone" });
  assert.deepEqual(actualSleep("2026-09-30", { sleepLog }), { minute: 1440 + 53, source: "phone" });
});

test("an 'up' from the phone beats a guess from signals", () => {
  const sleepLog = [{ event: "bed", at: at("2026-10-01", 0, 53) }, { event: "up", at: at("2026-10-01", 6, 38) }];
  assert.deepEqual(actualWake("2026-10-01", { sleepLog, phoneSignals: [{ at: at("2026-10-01", 6, 50), charging: false }] }), { minute: 398, source: "phone" });
});

test("a nap ending in the afternoon, or nothing at all, is not a wake-up", () => {
  const nights = [{ fellAsleep: at("2026-10-01", 13, 0), wokeAt: at("2026-10-01", 15, 30) }];
  assert.equal(actualWake("2026-10-01", { nights }), null);
  assert.equal(actualWake("2026-10-02", {}), null);
});
