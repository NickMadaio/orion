// The built-in nutrition table (nutrition-table.json, ~150 foods and dishes, per 100 g). The model is good at
// "what is on the plate and roughly how much"; it is bad at per-gram arithmetic. So when an item matches a row,
// the model's grams stay and the row supplies the density (grounding).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const FILE = join(dirname(fileURLToPath(import.meta.url)), "nutrition-table.json");

/** Words that describe a portion or a container, never the food ("a large can of coke" is coke). */
const NOISE = new Set(["a", "an", "the", "some", "of", "small", "large", "big", "medium", "huge", "regular", "can", "glass",
  "cup", "slice", "slices", "piece", "pieces", "portion", "serving", "plate", "side", "homemade", "fresh", "my", "half", "and", "with"]);

export const normalise = (s) => String(s ?? "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const words = (s) => normalise(s).split(" ").filter((w) => w && !NOISE.has(w));
const singular = (w) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);
const key = (s) => words(s).map(singular).join(" ");

let cached = null;
export function loadTable(file = FILE) {
  if (cached && file === FILE) return cached;
  const raw = JSON.parse(readFileSync(file, "utf8"));
  const foods = (raw.foods ?? []).map((f) => ({ ...f, keys: [f.name, f.name.split(",")[0], ...(f.aliases ?? [])].map(key).filter(Boolean) }));
  const table = { version: raw.version, foods };
  if (file === FILE) cached = table;
  return table;
}

/**
 The row for an item name, or null. An exact name/alias wins; otherwise the longest alias that appears as a whole
 phrase inside the name and covers at least half of its words ("grilled chicken breast" is chicken breast; "quinoa
 salad with feta" is not "salad", because one word of three is not enough to trust the density).
*/
export function matchFood(name, table = loadTable()) {
  const k = key(name);
  if (!k) return null;
  let best = null;
  for (const food of table.foods) {
    for (const alias of food.keys) {
      if (alias === k) return food;
      const inside = ` ${k} `.includes(` ${alias} `);
      const share = alias.split(" ").length / k.split(" ").length;
      if (inside && share >= 0.5 && (!best || alias.length > best.len)) best = { food, len: alias.length };
    }
  }
  return best?.food ?? null;
}

/** kcal and macros for `grams` of a matched row, rounded the way the log stores them. */
export function fromTable(food, grams) {
  const r = grams / 100;
  const per = food.per100g;
  return { kcal: Math.round(per.kcal * r), p: round1(per.p * r), c: round1(per.c * r), f: round1(per.f * r) };
}

export const round1 = (n) => Math.round(n * 10) / 10;
