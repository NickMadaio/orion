// V3 cases: normalised, validated against the menu, split once with a fixed
// seed and stratified, and held-out cases never reach tuning (handoff §13.3).
import { test } from "node:test";
import assert from "node:assert/strict";
import { normaliseCase, validateCase, makeSplit, selectCases } from "../scripts/lib/eval/v3/cases.mjs";

const menu = new Set(["weather", "lights", "alarm", "session", "reschedule"]);

test("synthetic shorthand becomes the common case shape", () => {
  const c = normaliseCase({ id: "j1-syn-time", clock: "Fri 10:12", say: "what time is it", moves: ["answer"] }, { job: "J1", provenance: "synthetic-edge" });
  assert.deepEqual(c.expect.J1, { moves: ["answer"], tiers: [], tools: [], args: null });
  assert.equal(c.job, "J1");
  assert.equal(c.provenance, "synthetic-edge");
  assert.deepEqual(c.history, []);
});

test("validation names every problem", () => {
  const bad = normaliseCase({ id: "x", say: "", moves: ["shout"], tools: ["teleport"], args: "(" }, { job: "J1", provenance: "synthetic-edge" });
  const errors = validateCase(bad, { menu });
  assert.ok(errors.some((e) => /say/.test(e)));
  assert.ok(errors.some((e) => /move shout/.test(e)));
  assert.ok(errors.some((e) => /tool teleport/.test(e)));
  assert.ok(errors.some((e) => /args/.test(e)));
  const toolNoTools = normaliseCase({ id: "y", say: "lights", moves: ["tool"] }, { job: "J1", provenance: "synthetic-edge" });
  assert.ok(validateCase(toolNoTools, { menu }).some((e) => /no acceptable tool/.test(e)));
  const escNoTier = normaliseCase({ id: "z", say: "redo my day", moves: ["escalate"] }, { job: "J1", provenance: "synthetic-edge" });
  assert.ok(validateCase(escNoTier, { menu }).some((e) => /no acceptable tier/.test(e)));
});

const many = Array.from({ length: 60 }, (_, i) => normaliseCase({ id: `c${i}`, say: "x", moves: [["answer", "tool", "ignore"][i % 3]], tools: i % 3 === 1 ? ["lights"] : [] },
  { job: "J1", provenance: i % 2 ? "observed-everyday" : "synthetic-edge" }));

test("the split is deterministic, about one third held out, and stratified", () => {
  const a = makeSplit(many, { seed: 20261008 });
  assert.deepEqual(makeSplit(many, { seed: 20261008 }), a);
  const held = Object.values(a).filter((v) => v === "heldout").length;
  assert.ok(held >= 18 && held <= 22, String(held));
  for (const prov of ["observed-everyday", "synthetic-edge"]) {
    const ids = many.filter((c) => c.provenance === prov).map((c) => c.id);
    assert.ok(ids.some((id) => a[id] === "heldout") && ids.some((id) => a[id] === "practice"), prov);
  }
});

test("a new case joins the split without moving old ones", () => {
  const a = makeSplit(many, { seed: 20261008 });
  const b = makeSplit([...many, normaliseCase({ id: "new", say: "x", moves: ["answer"] }, { job: "J1", provenance: "synthetic-edge" })], { seed: 20261008, previous: a });
  for (const [id, part] of Object.entries(a)) assert.equal(b[id], part);
  assert.ok(["practice", "heldout"].includes(b.new));
});

test("tuning can only select practice cases; the final run only held-out", () => {
  const split = makeSplit(many, { seed: 1 });
  const practice = selectCases(many, split, "practice");
  assert.ok(practice.length > 0 && practice.every((c) => split[c.id] === "practice"));
  assert.throws(() => selectCases(many, split, "everything"), /practice|heldout/);
});
