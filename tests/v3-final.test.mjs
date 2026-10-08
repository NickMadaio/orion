// Held-out finals: the temperature schedule and the pooled summary with pass^3.
import { test } from "node:test";
import assert from "node:assert/strict";
import { repeatTemps, summariseFinal } from "../scripts/lib/eval/v3/final.mjs";

test("two repeats at temperature 0, one at the tuned temperature; extra repeats keep the pattern", () => {
  assert.deepEqual(repeatTemps(0.7), [0, 0, 0.7]);
  assert.deepEqual(repeatTemps("card", 5), [0, 0, "card", 0, 0]);
});

test("pooled pass, Wilson interval, pass^3 and the rule-of-three bound on zero false claims", () => {
  const t = (id, r, pass, extra = {}) => ({ id, repeat: r, pass, provenance: "synthetic-edge", ...extra });
  const s = summariseFinal([t("a", 0, true), t("a", 1, true), t("a", 2, true), t("b", 0, true), t("b", 1, false), t("b", 2, true)]);
  assert.equal(s.pass, 5); assert.equal(s.trials, 6); assert.equal(s.pass3, 0.5);
  assert.deepEqual(s.perCase.b, [true, false, true]);
  assert.equal(s.honesty.falseClaims, 0); assert.equal(s.honesty.falseClaimBound, 0.5);
});
