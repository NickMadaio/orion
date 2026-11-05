// Sanity bounds on an estimate (w20 r4, live gate 2026-11-05 #80: "how much protein is in a chicken wrap" answered 87 g).
// The model is good at naming the food and bad at believing its own numbers, and the table cannot name every dish. So after grounding,
// every item is held to what one portion of that kind of food can be: a cap on grams for a food the table knows (a few servings), and a
// cap on protein, fat and calories by the kind of dish. An item over a cap is scaled down to it, whole, so its mix stays what the model
// said, and the estimate says it was capped. A wrap is about 25-35 g of protein, a slice of pizza about 12 (two, 25-35), a whole meal rarely over 100.
import { totalsOf, overallConfidence } from "./schema.mjs";
import { matchFood } from "./table.mjs";
import { round1 } from "./table.mjs";

/** Largest protein (g) one item of this kind can honestly carry; the first matching row wins. */
const PROTEIN_CAPS = [
  [/\b(?:wrap|burrito|sandwich|sub|panini|toastie|taco|kebab|gyro|bagel)s?\b/i, 45],
  [/\b(?:burger|cheeseburger|hamburger|hot ?dog|sausage roll|nuggets?)\b/i, 45],
  [/\b(?:pizza|slice|quesadilla|samosa|pasty|pie)\b/i, 45],
  [/\b(?:bar|cookie|biscuit|muffin|cake|donut|doughnut|croissant|toast|bread|roll)s?\b/i, 30],
  [/\b(?:egg|eggs|yoghurt|yogurt|cheese|milk|shake|smoothie|cereal|oats|porridge|banana|apple|fruit|rice|pasta|noodles?|fries|chips|crisps)\b/i, 45],
];
const DEFAULT_PROTEIN_CAP = 70;
const FAT_CAP = 90;
const KCAL_CAP_PER_ITEM = 1800;
/** Servings of a food the table knows that one item may be (2 wraps are two items or a named count). */
const SERVINGS = 4;
const MIN_GRAMS_CAP = 150;

function scaled(item, factor) {
  return { ...item, grams: Math.max(1, Math.round(item.grams * factor)), kcal: Math.round(item.kcal * factor), p: round1(item.p * factor), c: round1(item.c * factor), f: round1(item.f * factor) };
}

/** The estimate with every item held to its caps, and a flag for each one that was. Pure. */
export function sanityBound(estimate, table) {
  const flags = [...(estimate.flags ?? [])];
  const items = estimate.items.map((item) => {
    const row = matchFood(item.name, table);
    const caps = [];
    if (row?.servingG) caps.push(Math.max(MIN_GRAMS_CAP, row.servingG * SERVINGS) / item.grams);
    caps.push((PROTEIN_CAPS.find(([re]) => re.test(item.name))?.[1] ?? DEFAULT_PROTEIN_CAP) / Math.max(item.p, 0.001));
    caps.push(FAT_CAP / Math.max(item.f, 0.001), KCAL_CAP_PER_ITEM / Math.max(item.kcal, 1));
    const factor = Math.min(1, ...caps);
    if (factor >= 1) return item;
    flags.push(`${item.name}: scaled down to a portion it could be (the numbers were too high)`);
    return scaled(item, factor);
  });
  if (flags.length === (estimate.flags ?? []).length) return estimate;
  return { ...estimate, items, totals: totalsOf(items), confidence: overallConfidence(items), flags };
}
