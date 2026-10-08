// The V3 tuning loop (handoff §9): one change at a time, keep only a real
// improvement without more critical misroutes or false claims, the same budget
// for every model, early stop after three non-improving steps.
import { test } from "node:test";
import assert from "node:assert/strict";
import { tune, keeps } from "../scripts/lib/eval/v3/tune.mjs";

const step = (name, key, value) => ({ name, hypothesis: `try ${name}`, apply: (c) => ({ ...c, [key]: value }) });

test("keep needs ≥1 more pass and no more critical misroutes or false claims", () => {
  const best = { pass: 50, critical: 2, falseClaims: 0 };
  assert.equal(keeps({ pass: 51, critical: 2, falseClaims: 0 }, best), true);
  assert.equal(keeps({ pass: 50, critical: 1, falseClaims: 0 }, best), false);
  assert.equal(keeps({ pass: 55, critical: 3, falseClaims: 0 }, best), false);
  assert.equal(keeps({ pass: 55, critical: 2, falseClaims: 1 }, best), false);
});

test("improvements accumulate; a worse step is reverted", async () => {
  const evaluate = async (cfg) => ({ pass: 40 + (cfg.a ? 5 : 0) + (cfg.b ? -3 : 0) + (cfg.c ? 4 : 0), critical: 0, falseClaims: 0 });
  const r = await tune({ start: {}, ladder: [step("a", "a", 1), step("b", "b", 1), step("c", "c", 1)], evaluate });
  assert.deepEqual(r.best.config, { a: 1, c: 1 });
  assert.equal(r.best.result.pass, 49);
  assert.deepEqual(r.history.map((h) => h.kept), [true, false, true]);
});

test("budget and early stop: at most 8 iterations, stop after 3 non-improving", async () => {
  const ladder = Array.from({ length: 12 }, (_, i) => step(`s${i}`, `k${i}`, 1));
  const flat = await tune({ start: {}, ladder, evaluate: async () => ({ pass: 10, critical: 0, falseClaims: 0 }) });
  assert.equal(flat.history.length, 3);
  assert.equal(flat.stopped, "plateau");
  let n = 0;
  const rising = await tune({ start: {}, ladder, evaluate: async () => ({ pass: 10 + n++, critical: 0, falseClaims: 0 }) });
  assert.equal(rising.history.length, 8);
  assert.equal(rising.stopped, "budget");
});
