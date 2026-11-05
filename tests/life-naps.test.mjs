import { test } from "node:test";
import assert from "node:assert/strict";
import { napMinutesOf, totalSleepHours, napCreditMinutes, napsOn, whoopWorkoutsOf, recoveryTrend, napPhrase } from "../scripts/lib/life/naps.mjs";
import { recoveryLevel, recoveryFromLog } from "../scripts/lib/life/recovery.mjs";
import { bedOn, nightMarkers } from "../scripts/lib/life/night.mjs";
import { weekPlan } from "../scripts/lib/life/sleep-plan.mjs";
import { gymEvidence } from "../scripts/lib/life/attendance.mjs";

const nap70 = { start: "2026-11-03T15:00:00Z", end: "2026-11-03T16:10:00Z", minutes: 70, performance: 61 };
const log = { days: {
  "2026-11-02": { sleepHours: 7.5, recovery: 60 },
  "2026-11-03": { sleepHours: 5.2, recovery: 40, naps: [nap70], napMinutes: 70, strain: 8 },
  "2026-11-04": { sleepHours: 6, recovery: 80 },
} };

test("nap minutes come from the day record, never negative or junk", () => {
  assert.equal(napMinutesOf(log.days["2026-11-03"]), 70);
  assert.equal(napMinutesOf({ naps: [{ minutes: 20 }, { minutes: 15 }] }), 35, "falls back to summing the naps");
  assert.equal(napMinutesOf({ napMinutes: -5 }), 0);
  assert.equal(napMinutesOf(undefined), 0);
  assert.equal(napMinutesOf({ napMinutes: "lots" }), 0);
});

test("total sleep is the night plus the naps", () => {
  assert.equal(totalSleepHours(log.days["2026-11-03"]), 6.4);
  assert.equal(totalSleepHours({ napMinutes: 30 }), 0.5, "a nap with no scored night is still sleep");
  assert.equal(totalSleepHours({}), null, "no data stays unknown");
  assert.equal(totalSleepHours({ sleepHours: 7 }), 7);
});

test("a nap credits tonight's need: half its length, capped at an hour, short dozes ignored", () => {
  assert.equal(napCreditMinutes(70), 35);
  assert.equal(napCreditMinutes(200), 60);
  assert.equal(napCreditMinutes(15), 0);
  assert.equal(napCreditMinutes(0), 0);
});

test("naps on a date, and the phrase ORION says", () => {
  assert.deepEqual(napsOn(log, "2026-11-03"), [nap70]);
  assert.deepEqual(napsOn(log, "2026-11-04"), []);
  assert.match(napPhrase(nap70, () => "15:00"), /napped 1h10 at 15:00/);
  assert.match(napPhrase({ start: nap70.start, minutes: 25 }, () => "13:30"), /napped 25 min at 13:30/);
});

test("recovery counts the nap: a 5.2h night plus a 70 min nap is not a short night", () => {
  const rec = { recovery: 60, sleepHours: 4.6, napMinutes: 60 };
  assert.equal(recoveryLevel({ recovery: 60, sleepHours: 4.6 }).level, "low");
  assert.equal(recoveryLevel(rec).level, "normal");
});

test("sleep debt uses total sleep for earlier days", () => {
  const history = [{ sleepHours: 4, napMinutes: 120 }, { sleepHours: 4, napMinutes: 120 }, { sleepHours: 5 }];
  const r = recoveryLevel({ recovery: 60, sleepHours: 6 }, history);
  assert.equal(r.debtHours, 7, "(8-6)+(8-6)+(8-5)=7 with naps, 11 without");
  assert.equal(recoveryLevel({ recovery: 60, sleepHours: 6 }, history.map(({ sleepHours }) => ({ sleepHours }))).level, "low");
  assert.equal(r.level, "normal");
});

test("recoveryFromLog sees naps on the log", () => {
  const l = { days: { "2026-11-03": { recovery: 50, sleepHours: 4.6, napMinutes: 70 } } };
  assert.equal(recoveryFromLog(l, "2026-11-03").level, "normal");
});

const config = { usualWake: "09:00", bedtime: "00:00", sleepHours: 8, readyMinutes: 75, commuteMinutes: 30 };
const blocksOf = (d) => (d === "2026-11-05" ? [{ title: "CS1800 Lecture", start: 540, end: 630, fixed: true, source: "calendar" }] : []);

test("a nap pushes the bedtime later by its credit, never earlier", () => {
  // free day after: bedtime target midnight; with a 70 min nap tonight may slide 35 min
  assert.equal(bedOn("2026-11-03", { blocksOf, config }), 1440);
  assert.equal(bedOn("2026-11-03", { blocksOf, config, napMinutes: 70 }), 1440 + 35);
  assert.equal(bedOn("2026-11-03", { blocksOf, config, napMinutes: 10 }), 1440, "a doze changes nothing");
});

test("an early morning still caps the bed by the credited need", () => {
  // 9:00 lecture, ready 75 -> wake 7:45; need 8h -> 23:45; nap 70 -> need 7h25 -> 00:20 but the credit-shifted target is 00:35
  assert.equal(bedOn("2026-11-04", { blocksOf, config }), 1440 + 465 - 480);
  assert.equal(bedOn("2026-11-04", { blocksOf, config, napMinutes: 70 }), 1440 + 465 - 480 + 35);
});

test("night markers and the week plan take the nap from napMinutesOf(date)", () => {
  const markers = nightMarkers("2026-11-03", { blocksOf, config, napMinutes: 70 });
  assert.equal(markers.bed, 1475);
  const now = new Date(2026, 10, 3, 18, 0);
  const days = weekPlan({ now, config, blocksOf, napMinutesOf: (d) => (d === "2026-11-03" ? 70 : 0) });
  const tonight = days.find((d) => d.evening === "2026-11-03");
  const tomorrow = days.find((d) => d.evening === "2026-11-04");
  assert.equal(tonight.sleepBy, "00:35");
  assert.equal(tomorrow.sleepBy, "23:45", "a nap today does not shift tomorrow night");
});

test("WHOOP workouts become gym evidence", () => {
  const l = { days: { "2026-11-04": { whoopWorkouts: [{ id: "w1", start: "2026-11-04T18:00:00Z", end: "2026-11-04T19:05:00Z", minutes: 65, strain: 11.2, sport: "weightlifting" }] } }, workouts: [] };
  const flat = whoopWorkoutsOf(l);
  assert.equal(flat.length, 1);
  assert.equal(flat[0].source, "whoop");
  assert.equal(flat[0].startedAt, "2026-11-04T18:00:00Z");
  assert.equal(flat[0].durationMin, 65);
  const seen = gymEvidence({ date: new Date("2026-11-04T18:00:00Z").toLocaleDateString("en-CA"), workouts: flat, now: new Date("2026-11-05T12:00:00Z") });
  assert.equal(seen.source, "whoop");
});

test("recovery trend: latest against the mean before it, and the direction", () => {
  const l = { days: { a1: { recovery: 50 }, a2: { recovery: 60 }, a3: { recovery: 70 }, a4: { recovery: 80 } } };
  const t = recoveryTrend(l, 7);
  assert.equal(t.latest, 80);
  assert.equal(t.baseline, 60);
  assert.equal(t.direction, "up");
  assert.equal(recoveryTrend({ days: { a: { recovery: 50 } } }, 7).direction, null, "one day is not a trend");
});
