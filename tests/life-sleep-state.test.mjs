import { test } from "node:test";
import assert from "node:assert/strict";
import { sleepState } from "../scripts/lib/life/sleep-state.mjs";

const base = { bedtime: 0, wake: 480 };
test("midday is day", () => assert.equal(sleepState({ ...base, now: 720, lastActiveMinutesAgo: 1 }).state, "day"));
test("using the phone at 3am is awake late", () => {
  const r = sleepState({ ...base, now: 180, lastActiveMinutesAgo: 1 });
  assert.equal(r.state, "awake_late"); assert.equal(r.minutesPastBedtime, 180);
});
test("quiet and charging is probably asleep", () => assert.equal(sleepState({ ...base, now: 180, lastActiveMinutesAgo: 40, charging: true }).state, "probably_asleep"));
test("no activity signal is unknown", () => assert.equal(sleepState({ ...base, now: 180, lastActiveMinutesAgo: null }).state, "unknown"));
test("a bedtime before midnight spans midnight", () => {
  const r = sleepState({ bedtime: 1380, wake: 480, now: 60, lastActiveMinutesAgo: 1 });
  assert.equal(r.state, "awake_late"); assert.equal(r.minutesPastBedtime, 120);
});
test("just after wake is day", () => assert.equal(sleepState({ ...base, now: 481, lastActiveMinutesAgo: 1 }).state, "day"));
