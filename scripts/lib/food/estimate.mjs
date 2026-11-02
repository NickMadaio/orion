// Text and/or photos in, a checked estimate out (orion-food-estimate). The model names and sizes the food; the
// schema clamps and macro-checks it; the table supplies per-gram numbers wherever an item matches a known food.
import { askModel } from "./ollama.mjs";
import { extractJson, totalsOf, validateEstimate, overallConfidence } from "./schema.mjs";
import { fromTable, loadTable, matchFood } from "./table.mjs";

/** Replaces the model's per-gram numbers with the table's for every item that matches a row (alcohol rows excepted). */
export function ground(estimate, table = loadTable()) {
  const items = estimate.items.map((item) => {
    const food = matchFood(item.name, table);
    if (!food || food.alcohol) return item;
    return { ...item, ...fromTable(food, item.grams), grounded: food.name };
  });
  return { ...estimate, items, totals: totalsOf(items), confidence: overallConfidence(items) };
}

const listed = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(", ")} and ${xs.at(-1)}` : xs[0] ?? "");
/** The first clause of an assumption, never cut mid-word: "guessed the oil". */
const short = (s) => {
  const clause = s.replace(/\s*\([^)]*\)/g, "").split(/[,;:]|\.\s/)[0].replace(/\.$/, "").trim().replace(/^./, (c) => c.toLowerCase());
  return clause.length <= 60 ? clause : `${clause.slice(0, 60).replace(/\s+\S*$/, "")}…`;
};
/** Item names with repeats counted: "2× pepperoni pizza slice". */
const counted = (items) => {
  const counts = new Map();
  for (const i of items) { const n = i.name.toLowerCase(); counts.set(n, (counts.get(n) ?? 0) + 1); }
  return [...counts].map(([n, k]) => (k > 1 ? `${k}× ${n}` : n));
};

/** "~650 kcal · 45P 70C 18F (chicken rice bowl, ~400 g; guessed the oil)" */
export function summaryLine(estimate) {
  const t = estimate.totals;
  const kcal = t.kcal >= 100 ? Math.round(t.kcal / 10) * 10 : Math.round(t.kcal);
  const names = counted(estimate.items);
  const what = names.length > 3 ? `${names.slice(0, 3).join(", ")} +${names.length - 3} more` : listed(names);
  const grams = t.grams >= 50 ? `, ~${Math.round(t.grams / 10) * 10} g` : "";
  const note = estimate.assumptions[0] ? `; ${short(estimate.assumptions[0])}` : "";
  return `~${kcal} kcal · ${Math.round(t.p)}P ${Math.round(t.c)}C ${Math.round(t.f)}F (${what}${grams}${note})`;
}

/**
 Runs one estimate. input: { text?, images?: base64[], imagePaths?: string[], correction?, previous? }.
 Resolves { ok: true, estimate, summary, ms } or { ok: false, error, ms }; never throws.
*/
export async function estimateMeal(input, deps = {}) {
  const text = String(input.text ?? "").trim();
  const images = input.images ?? [];
  if (!text && !images.length) return { ok: false, error: "nothing to estimate: give a description or a photo", ms: 0 };
  const asked = await askModel({ text, images, correction: input.correction, previous: input.previous }, deps);
  if (!asked.ok) return { ok: false, error: asked.error, ms: asked.ms };
  const parsed = extractJson(asked.content);
  if (!parsed) return { ok: false, error: "the local model's answer wasn't JSON", ms: asked.ms };
  const checked = validateEstimate(parsed);
  if (!checked.ok) return { ok: false, error: checked.error, ms: asked.ms };
  const estimate = {
    ...(deps.ground === false ? checked.estimate : ground(checked.estimate, deps.table)),
    input: { ...(text ? { text } : {}), ...(input.imagePaths?.length ? { photos: input.imagePaths } : {}), ...(input.correction ? { correction: input.correction } : {}) },
  };
  return { ok: true, estimate, summary: summaryLine(estimate), ms: asked.ms };
}
