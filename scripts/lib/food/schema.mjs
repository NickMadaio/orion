// What the model must return, and what is done when it does not quite (orion-food-estimate).
//   { items: [{ name, grams, kcal, p, c, f, confidence }], totals: {kcal,p,c,f}, assumptions: [string] }
// Parsing is forgiving (a fenced block, prose around the object); the values are not: every number is clamped to
// something a meal can be, kcal must agree with 4p + 4c + 9f within 15% or it is rebuilt from the macros (and said),
// and totals are always recomputed from the items, never taken from the model.
import { round1 } from "./table.mjs";

export const MACRO_TOLERANCE = 0.15;
export const LIMITS = { grams: 3000, kcal: 5000, macro: 500, items: 20, name: 60, assumption: 140 };
const CONFIDENCE = ["low", "medium", "high"];

/** The JSON schema handed to Ollama's structured output (`format`), so the 9b is held to the shape while it writes. */
export const ESTIMATE_JSON_SCHEMA = {
  type: "object",
  properties: {
    items: { type: "array", items: { type: "object", properties: {
      name: { type: "string" }, grams: { type: "number" }, kcal: { type: "number" }, p: { type: "number" }, c: { type: "number" }, f: { type: "number" },
      confidence: { type: "string", enum: CONFIDENCE } }, required: ["name", "grams", "kcal", "p", "c", "f", "confidence"] } },
    totals: { type: "object", properties: { kcal: { type: "number" }, p: { type: "number" }, c: { type: "number" }, f: { type: "number" } } },
    assumptions: { type: "array", items: { type: "string" } },
  },
  required: ["items", "assumptions"],
};

/** The first JSON object in the model's text (fenced or bare), or null. */
export function extractJson(text) {
  const s = String(text ?? "");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s)?.[1];
  for (const candidate of [fenced, s]) {
    if (!candidate) continue;
    const start = candidate.indexOf("{"), end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try { return JSON.parse(candidate.slice(start, end + 1)); } catch { /* try the next */ }
  }
  return null;
}

const num = (v) => (typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : Number.NaN);
const clamp = (v, max) => Math.min(max, Math.max(0, Number.isFinite(v) ? v : 0));
const text = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
export const macroKcal = ({ p, c, f }) => 4 * p + 4 * c + 9 * f;

/** One item, clamped and macro-checked. Returns { item, notes } or null when it cannot be a food at all. */
export function cleanItem(raw) {
  if (!raw || typeof raw !== "object") return null;
  const name = text(raw.name, LIMITS.name);
  const grams = clamp(num(raw.grams), LIMITS.grams);
  if (!name || grams <= 0) return null;
  const notes = [];
  const clamped = ["kcal", "p", "c", "f"].some((k) => num(raw[k]) > (k === "kcal" ? LIMITS.kcal : LIMITS.macro));
  if (clamped) notes.push(`${name}: an impossible number was capped`);
  const p = round1(clamp(num(raw.p), LIMITS.macro)), c = round1(clamp(num(raw.c), LIMITS.macro)), f = round1(clamp(num(raw.f), LIMITS.macro));
  let kcal = Math.round(clamp(num(raw.kcal), LIMITS.kcal));
  const fromMacros = Math.round(macroKcal({ p, c, f }));
  if (fromMacros > 0 && Math.abs(kcal - fromMacros) > MACRO_TOLERANCE * Math.max(kcal, fromMacros)) {
    notes.push(`${name}: calories rebuilt from the macros (said ${kcal}, macros give ${fromMacros})`);
    kcal = fromMacros;
  }
  const confidence = CONFIDENCE.includes(String(raw.confidence).toLowerCase()) ? String(raw.confidence).toLowerCase() : "low";
  return { item: { name, grams: Math.round(grams), kcal, p, c, f, confidence }, notes };
}

export const totalsOf = (items) => {
  const sum = (k) => items.reduce((a, i) => a + i[k], 0);
  return { kcal: Math.round(sum("kcal")), p: round1(sum("p")), c: round1(sum("c")), f: round1(sum("f")), grams: Math.round(sum("grams")) };
};

/** The lowest item confidence, weighted toward the items that carry the calories. */
export function overallConfidence(items) {
  if (!items.length) return "low";
  const total = items.reduce((a, i) => a + i.kcal, 0) || 1;
  const score = items.reduce((a, i) => a + (CONFIDENCE.indexOf(i.confidence) + 1) * (i.kcal / total), 0);
  return score >= 2.5 ? "high" : score >= 1.6 ? "medium" : "low";
}

/** Validates a parsed model answer. { ok: true, estimate } or { ok: false, error }. */
export function validateEstimate(parsed) {
  if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.items)) return { ok: false, error: "the model's answer had no items list", noFood: true };
  const cleaned = parsed.items.slice(0, LIMITS.items).map(cleanItem).filter(Boolean);
  if (!cleaned.length) return { ok: false, error: "the model named no food it could size", noFood: true };
  const items = cleaned.map((x) => x.item);
  const flags = cleaned.flatMap((x) => x.notes);
  const assumptions = (Array.isArray(parsed.assumptions) ? parsed.assumptions : []).map((a) => text(a, LIMITS.assumption)).filter(Boolean).slice(0, 8);
  return { ok: true, estimate: { items, totals: totalsOf(items), assumptions, flags, confidence: overallConfidence(items) } };
}
