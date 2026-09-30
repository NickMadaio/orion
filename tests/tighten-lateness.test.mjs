import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lateness, delayOf } from "../scripts/lib/life/lateness.mjs";

describe("delay wraps around midnight", () => {
  // planned 1430, actual 10 → +20
  const r1 = { plannedStart: 1430, actualStart: 10 };
  assert.equal(delayOf(r1), 20);

  // planned 10, actual 1430 → -20
  const r2 = { plannedStart: 10, actualStart: 1430 };
  assert.equal(delayOf(r2), -20);
});

describe("too few records says so", () => {
  const records = [
    { at: "2026-09-29T19:26:29.314Z", what: "x", kind: "study", plannedStart: 1200, actualStart: 1210, weekday: 2 },
  ];
  const result = lateness(records);
  assert.equal(result.sentence, "Only 1 check-in so far — I'll know your pattern after 3.");
});

describe("overall median and on-time rate", () => {
  // delays [0, 10, 30, 45] started + one skipped
  const records = [
    { at: "2026-09-20T10:00:00Z", kind: "study", plannedStart: 1200, actualStart: 1200, weekday: 1 },   // delay 0
    { at: "2026-09-21T10:00:00Z", kind: "study", plannedStart: 1200, actualStart: 1210, weekday: 2 },   // delay 10
    { at: "2026-09-22T10:00:00Z", kind: "study", plannedStart: 1200, actualStart: 1230, weekday: 3 },   // delay 30
    { at: "2026-09-23T10:00:00Z", kind: "study", plannedStart: 1200, actualStart: 1245, weekday: 4 },   // delay 45
    { at: "2026-09-24T10:00:00Z", kind: "study", plannedStart: 1200, actualStart: null, weekday: 5 },   // skipped
  ];
  const result = lateness(records);
  assert.equal(result.overall.medianDelay, 20); // median of [0,10,30,45] = (10+30)/2 = 20
  assert.equal(result.overall.onTimeRate, 0.25); // 1 of 4 started has delay <= 5
  assert.equal(result.overall.skipped, 1);
});

describe("worst kind is named when clearly worse", () => {
  // study delays [40,35,30], gym [0,5,0]
  const records = [
    { at: "2026-09-20T10:00:00Z", kind: "study", plannedStart: 1200, actualStart: 1240, weekday: 1 },
    { at: "2026-09-21T10:00:00Z", kind: "study", plannedStart: 1200, actualStart: 1235, weekday: 2 },
    { at: "2026-09-22T10:00:00Z", kind: "study", plannedStart: 1200, actualStart: 1230, weekday: 3 },
    { at: "2026-09-23T10:00:00Z", kind: "gym", plannedStart: 1200, actualStart: 1200, weekday: 4 },
    { at: "2026-09-24T10:00:00Z", kind: "gym", plannedStart: 1200, actualStart: 1205, weekday: 5 },
    { at: "2026-09-25T10:00:00Z", kind: "gym", plannedStart: 1200, actualStart: 1200, weekday: 6 },
  ];
  const result = lateness(records);
  // Overall median of [40,35,30,0,5,0] sorted: [0,0,5,30,35,40] → (5+30)/2 = 17.5 → 18
  assert.equal(result.overall.medianDelay, 18);
  // study median of [40,35,30] → 35. 35 >= 18 + 15 = 33? Yes.
  assert.ok(result.sentence.includes("worst with study"));
});

describe("bands and weekdays", () => {
  const records = [
    { at: "2026-09-20T10:00:00Z", kind: "study", plannedStart: 540, actualStart: 550, weekday: 2 },   // morning
    { at: "2026-09-21T10:00:00Z", kind: "study", plannedStart: 1200, actualStart: 1210, weekday: 3 },  // evening
  ];
  const result = lateness(records);
  assert.ok(result.byBand.morning.samples >= 1);
  assert.ok(result.byBand.evening.samples >= 1);
  assert.ok(result.byWeekday["2"] != null);
});

describe("trend detects slipping", () => {
  // six started records ordered by at, older delays [0,0,5], newer [20,25,30]
  const records = [
    { at: "2026-09-18T10:00:00Z", kind: "study", plannedStart: 1200, actualStart: 1200, weekday: 1 },   // 0
    { at: "2026-09-19T10:00:00Z", kind: "study", plannedStart: 1200, actualStart: 1200, weekday: 2 },   // 0
    { at: "2026-09-20T10:00:00Z", kind: "study", plannedStart: 1200, actualStart: 1205, weekday: 3 },   // 5
    { at: "2026-09-21T10:00:00Z", kind: "study", plannedStart: 1200, actualStart: 1220, weekday: 4 },   // 20
    { at: "2026-09-22T10:00:00Z", kind: "study", plannedStart: 1200, actualStart: 1225, weekday: 5 },   // 25
    { at: "2026-09-23T10:00:00Z", kind: "study", plannedStart: 1200, actualStart: 1230, weekday: 6 },   // 30
  ];
  const result = lateness(records);
  assert.equal(result.trend, "worse");
  assert.ok(result.sentence.endsWith("— slipping lately."));
});

describe("early starters are described as early", () => {
  // delays [-15,-20,-12]
  const records = [
    { at: "2026-09-20T10:00:00Z", kind: "study", plannedStart: 1200, actualStart: 1185, weekday: 1 },   // -15
    { at: "2026-09-21T10:00:00Z", kind: "study", plannedStart: 1200, actualStart: 1180, weekday: 2 },   // -20
    { at: "2026-09-22T10:00:00Z", kind: "study", plannedStart: 1200, actualStart: 1188, weekday: 3 },   // -12
  ];
  const result = lateness(records);
  assert.ok(result.sentence.includes("about 15 min early"));
});

describe("invalid input throws", () => {
  assert.throws(() => lateness("x"), TypeError);
});
