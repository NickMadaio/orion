import test from "node:test";
import assert from "node:assert/strict";
import { parseSequence, remainingFrom, recoverFromHistory, describeSequence, toRequestPhases } from "../scripts/lib/focus/sequence.mjs";

const f = minutes => ({ kind: "focus", minutes });
const r = minutes => ({ kind: "rest", minutes });

test("parses comma lists of work and break", () => {
  assert.deepEqual(parseSequence("20 work, 5 break, 40 work"), [f(20), r(5), f(40)]);
  assert.deepEqual(parseSequence("15 min work → 3 min break → 25 min work"), [f(15), r(3), f(25)]);
});

test("parses then-chains with number words, including Nick's recovery sentence", () => {
  assert.deepEqual(parseSequence("I had 20 minutes left, then a five-minute break, then another forty-minute block"), [f(20), r(5), f(40)]);
  assert.deepEqual(parseSequence("half an hour of study then a ten minute break then an hour"), [f(30), r(10), f(60)]);
});

test("parses compact forms 20w 5b 40w and 20/5/40", () => {
  assert.deepEqual(parseSequence("20w 5b 40w"), [f(20), r(5), f(40)]);
  assert.deepEqual(parseSequence("20/5/40"), [f(20), r(5), f(40)]);
});

test("a sequence may start with a break", () => {
  assert.deepEqual(parseSequence("5 min break then 40 min work"), [r(5), f(40)]);
});

test("rejects empty text, missing numbers and oversized phases", () => {
  assert.throws(() => parseSequence(""), TypeError);
  assert.throws(() => parseSequence("work then break"), /No length/);
  assert.throws(() => parseSequence("200 work"), /1–180/);
  assert.throws(() => parseSequence("90 break"), /1–60/);
});

test("remainingFrom starts mid-phase and drops a used-up first phase", () => {
  const plan = [f(40), r(10), f(40)];
  assert.deepEqual(remainingFrom(plan, { phaseIndex: 0, elapsedMinutes: 20 }), [f(20), r(10), f(40)]);
  assert.deepEqual(remainingFrom(plan, { phaseIndex: 1, elapsedMinutes: 10 }), [f(40)]);
  assert.throws(() => remainingFrom(plan, { phaseIndex: 3, elapsedMinutes: 0 }), TypeError);
});

test("recovers the unfinished part of an early-ended session", () => {
  const record = { reason: "early", plannedFocusSeconds: 4800, plannedRestSeconds: 600, servedFocusSeconds: 1200, completedFocusBlocks: 0, totalFocusBlocks: 2 };
  assert.deepEqual(recoverFromHistory(record), [f(20), r(10), f(40)]);
});

test("a completed session has nothing to recover", () => {
  assert.equal(recoverFromHistory({ reason: "completed", plannedFocusSeconds: 1800, servedFocusSeconds: 1800, totalFocusBlocks: 1 }), null);
});

test("describes sequences with hours", () => {
  assert.equal(describeSequence([f(70), r(5), f(60)]), "1h 10m focus → 5m break → 1h focus");
  assert.deepEqual(toRequestPhases([f(20), r(5)]), [{ kind: "focus", seconds: 1200 }, { kind: "rest", seconds: 300 }]);
});
