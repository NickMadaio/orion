// Per-model "what it gets right and wrong" (Nick, 2026-10-08): pass rates by
// kind of request and expected move, a confusion table, and top reasons.
import { test } from "node:test";
import assert from "node:assert/strict";
import { breakdown, categoryOf } from "../scripts/lib/eval/v3/breakdown.mjs";

const kase = (id, say, moves, tools = []) => ({ id, job: "J1", say, expect: { J1: { moves, tools, tiers: [] } } });
const cases = new Map([["a", kase("a", "turn the lights off", ["tool"], ["lights"])], ["b", kase("b", "redo my whole schedule", ["escalate"])], ["c", kase("c", "how's it going", ["answer"])]]);

test("categories combine the kind of request and the expected move", () => {
  assert.equal(categoryOf(cases.get("a")), "lights · tool");
  assert.equal(categoryOf(cases.get("b")), "schedule · escalate");
  assert.equal(categoryOf({ id: "j2-syn-alarm-label", job: "J2", say: "remind me at 6:55", expect: { calls: [["alarm", "call mom"]] } }), "reminder · alarm");
});

test("breakdown counts passes per category and per expected move, with a confusion table", () => {
  const trials = [{ id: "a", pass: true, move: "tool", reasons: [] }, { id: "b", pass: false, move: "tool", reasons: ["move tool not in escalate"] }, { id: "c", pass: false, move: "answer", reasons: ["empty answer"] }];
  const b = breakdown(trials, cases);
  assert.deepEqual(b.byCategory["schedule · escalate"], { n: 1, pass: 0, failing: ["b"] });
  assert.deepEqual(b.byExpected.escalate, { n: 1, pass: 0 });
  assert.equal(b.confusion.escalate.tool, 1);
  assert.equal(b.reasons["empty answer"], 1);
  assert.equal(b.reasons["move tool"], 1);
});
