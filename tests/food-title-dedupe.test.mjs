// w20 xf-other (tube audit A7): an estimate that lists the same food twice titled the log entry "protein bar, protein bar +1".
import test from "node:test";
import assert from "node:assert/strict";
import { entryFor } from "../scripts/lib/food/log.mjs";
import { mealName } from "../scripts/lib/food/pending.mjs";

const est = (names) => ({ items: names.map((name) => ({ name })), totals: { kcal: 570, p: 18, c: 69, f: 24 }, confidence: "medium", assumptions: [] });
const at = new Date("2026-11-04T14:30:00");

test("a food listed three times is titled once", () => {
  for (const names of [["protein bar", "protein bar", "protein bar"], ["Protein Bar", "protein bar", "PROTEIN BAR"]]) {
    assert.equal(entryFor(est(names), { meal: "lunch", at }).title.toLowerCase(), "protein bar");
    assert.equal(mealName(est(names)), "protein bar");
  }
});

test("distinct foods still list, and +N counts only the distinct extras", () => {
  assert.equal(entryFor(est(["egg", "toast"]), { meal: "breakfast", at }).title, "Egg and toast");
  assert.equal(entryFor(est(["egg", "egg", "toast"]), { meal: "breakfast", at }).title, "Egg and toast");
  assert.equal(entryFor(est(["egg", "toast", "bacon", "beans"]), { meal: "breakfast", at }).title, "Egg, toast +2");
  assert.equal(mealName(est(["egg", "egg", "toast", "bacon", "toast"])), "egg, toast +1");
});
