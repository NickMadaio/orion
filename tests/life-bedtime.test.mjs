import { test } from "node:test";
import assert from "node:assert/strict";
import { bedtimeNudge } from "../scripts/lib/life/bedtime.mjs";

test("daytime is none", () => assert.equal(bedtimeNudge({ state: "day", minutesPastBedtime: 0, nudgesSent: 0, firstFixedTomorrow: 540, now: 720 }).level, "none"));
test("just past bedtime is gentle", () => {
  const r = bedtimeNudge({ state: "awake_late", minutesPastBedtime: 5, nudgesSent: 0, firstFixedTomorrow: 540, now: 5 });
  assert.equal(r.level, "gentle"); assert.equal(r.recheckInMinutes, 15);
});
test("an hour past with nudges ignored escalates", () => {
  const r = bedtimeNudge({ state: "awake_late", minutesPastBedtime: 70, nudgesSent: 3, firstFixedTomorrow: 540, now: 70 });
  assert.equal(r.level, "escalated"); assert.equal(r.recheckInMinutes, 5);
});
test("message counts the sleep left before class", () => {
  const r = bedtimeNudge({ state: "awake_late", minutesPastBedtime: 180, nudgesSent: 3, firstFixedTomorrow: 540, now: 180 });
  assert.match(r.message, /5h 0m/);
  assert.match(r.message, /03:00/);
});
test("short nights promise an adjusted tomorrow", () => {
  const r = bedtimeNudge({ state: "awake_late", minutesPastBedtime: 300, nudgesSent: 5, firstFixedTomorrow: 540, now: 300 });
  assert.match(r.message, /adjust tomorrow/);
});
test("unknown class time leaves sleep count out", () => {
  const r = bedtimeNudge({ state: "winding_down", minutesPastBedtime: 20, nudgesSent: 0, firstFixedTomorrow: null, now: 20 });
  assert.doesNotMatch(r.message, /\dh \d+m/);
});
