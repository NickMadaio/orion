import { test } from "node:test";
import assert from "node:assert/strict";
import { learnPatterns } from "../scripts/lib/life/patterns.mjs";

test("rates and delays per kind", () => {
  const r = learnPatterns([{ kind: "study", plannedStart: 600, actualStart: 610 }, { kind: "study", plannedStart: 900, actualStart: 930 },
                           { kind: "study", plannedStart: 1000, actualStart: 1020 }]);
  assert.deepEqual(r.byKind.study, { planned: 3, happened: 3, rate: 1, medianDelay: 20 });
});
test("skipped blocks lower the rate", () => {
  const r = learnPatterns([{ kind: "gym", plannedStart: 600, actualStart: 600 }, { kind: "gym", plannedStart: 600, actualStart: null },
                           { kind: "gym", plannedStart: 600, actualStart: null }]);
  assert.equal(r.byKind.gym.rate, 0.33);
});
test("median wake time", () => {
  const r = learnPatterns([{ kind: "wake", minute: 450 }, { kind: "wake", minute: 480 }, { kind: "wake", minute: 510 }]);
  assert.deepEqual(r.wake, { median: 480, samples: 3 });
});
test("sleep after midnight averages correctly", () => {
  const r = learnPatterns([{ kind: "sleep", minute: 1410 }, { kind: "sleep", minute: 30 }, { kind: "sleep", minute: 90 }]);
  assert.equal(r.sleep.median, 30);
});
test("too few samples is null", () => assert.equal(learnPatterns([{ kind: "wake", minute: 480 }]).wake.median, null));
