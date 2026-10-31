import { test } from "node:test";
import assert from "node:assert/strict";
import { recoveryLevel, recoveryFromLog } from "../scripts/lib/life/recovery.mjs";

test("no numbers is unknown, never low", () => assert.equal(recoveryLevel({}).level, "unknown"));
test("recovery 1% and 3.7h is low, with reasons", () => {
  const r = recoveryLevel({ recovery: 1, sleepHours: 3.7 });
  assert.equal(r.level, "low"); assert.equal(r.gymMinutes, 45); assert.equal(r.studyScale, 0.6);
  assert.deepEqual(r.reasons, ["recovery 1%", "3.7h of sleep"]);
});
test("a good night is normal and changes nothing", () => {
  const r = recoveryLevel({ recovery: 70, sleepHours: 8 });
  assert.equal(r.level, "normal"); assert.equal(r.studyScale, 1); assert.equal(r.gymMinutes, null);
});
test("sleep debt alone does not make a rested morning low", () => {
  assert.equal(recoveryLevel({ recovery: 60, sleepHours: 7 }, [{ sleepHours: 4 }, { sleepHours: 4 }, { sleepHours: 5 }]).level, "normal");
});
test("debt plus a short night is low", () => {
  assert.equal(recoveryLevel({ recovery: 60, sleepHours: 6 }, [{ sleepHours: 4 }, { sleepHours: 4 }, { sleepHours: 5 }]).level, "low");
});
test("an all-nighter ORION saw overrides the record", () => {
  assert.equal(recoveryLevel({ recovery: 80, sleepHours: 8 }, [], { sleptHours: 0 }).level, "low");
});
test("recoveryFromLog reads the date and earlier days", () => {
  const log = { days: { "2026-10-29": { recovery: 53, sleepHours: 9.7 }, "2026-10-30": { recovery: 1, sleepHours: 3.7 } } };
  assert.equal(recoveryFromLog(log, "2026-10-30").level, "low");
  assert.equal(recoveryFromLog(log, "2026-10-29").level, "normal");
  assert.equal(recoveryFromLog({}, "2026-10-30").level, "unknown");
});
