// A workout description (or his answer to a follow-up) as a clean draft: the local model for the messy parts, the rules for the patterns
// that never need it, and the rules win on every number they found (orion-workout-log). Without the model the rules alone still work.
import { askModel } from "./ollama.mjs";
import { mergeDrafts, emptyDraft } from "./draft.mjs";
import { cleanDraft, extractJson } from "./schema.mjs";
import { isBodyweight, readRules } from "./rules.mjs";

const isEmpty = (d) => !d.exercises.length && !d.cardio.length && !d.sport && !d.title && !d.durationMin && d.type === "unknown";

/** When one lift is waiting for its numbers and his answer has none attached ("4x6 at 185"), the answer is about that lift. */
function named(text, prior) {
  const waiting = prior?.exercises.filter((e) => !e.sets || !e.reps || !e.weight) ?? [];
  const bare = /^\s*(?:\d+\s*(?:x|×|sets? of)\s*\d+|(?:at|w|with|@)\s*\d)/i.test(text);
  return waiting.length === 1 && bare ? `${waiting[0].name} ${text}` : text;
}

const WEIGHT_UNIT = String.raw`(lbs?|pounds?|kgs?|kilos?|#)?`;
/** One lift waiting for its weight and his answer names a number for it ("leg press was 300", "185 lbs", "300"): that is the weight. */
function weightFor(text, prior) {
  const waiting = prior?.exercises.filter((e) => e.sets && e.reps && !e.weight && !isBodyweight(e.name)) ?? [];
  if (!waiting.length) return null;
  for (const e of waiting) {
    const words = e.name.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3).map((w) => w.replace(/s$/, ""));
    for (const w of words) {
      const m = new RegExp(String.raw`\b${w}s?\b[^0-9,;]{0,12}?(\d+(?:\.\d+)?)\s*${WEIGHT_UNIT}\b(?!\s*(?:min|hour|hr|sets?|reps?))`, "i").exec(text);
      if (m) return { name: e.name, weight: Number(m[1]), unit: /^k/i.test(m[2] ?? "") ? "kg" : "lb" };
    }
  }
  const bare = new RegExp(String.raw`^\s*(?:about|around|like|roughly|maybe|~|at|was|it was)?\s*(\d+(?:\.\d+)?)\s*${WEIGHT_UNIT}\s*$`, "i").exec(text);
  return bare && waiting.length === 1 ? { name: waiting[0].name, weight: Number(bare[1]), unit: /^k/i.test(bare[2] ?? "") ? "kg" : "lb" } : null;
}

/**
 text: what he said now. prior: the draft so far (an answer). context: everything he has said about this workout (what a model's number must match).
 Resolves { ok: true, draft, via, ms } or { ok: false, error }.
*/
export async function readWorkout(text, { prior, context, today, fetchImpl, timeoutMs, url } = {}) {
  const said = [context, text].filter(Boolean).join(" ");
  const w = weightFor(text, prior);
  const base = cleanDraft(readRules(named(text, prior)), said) ?? emptyDraft();
  const rules = w ? mergeDrafts(base, { ...emptyDraft(), type: "strength", exercises: [{ name: w.name, sets: 0, reps: 0, weight: w.weight, unit: w.unit }] }) : base;
  const model = await askModel({ text, ...(prior ? { prior } : {}), today: today ?? new Date().toDateString() }, { fetchImpl, timeoutMs, url });
  const fromModel = model.ok ? cleanDraft(extractJson(model.content), said) : null;
  if (!fromModel && isEmpty(rules) && text.trim().split(/\s+/).length > 6) {
    return { ok: false, error: model.ok ? "I couldn't make a workout out of that" : model.error, ms: model.ms };
  }
  // The real 9b files "20 min on the stairmaster" as the whole session's length too (smoke run, 2026-11-03): a total that is just a cardio block's time is not a total.
  const cardioTimes = new Set([...(fromModel?.cardio ?? []).map((c) => c.minutes), (fromModel?.cardio ?? []).reduce((a, c) => a + c.minutes, 0)].filter(Boolean));
  const modelDraft = fromModel && !rules.durationMin && cardioTimes.has(fromModel.durationMin) ? { ...fromModel, durationMin: 0 } : fromModel;
  const found = modelDraft ? mergeDrafts(modelDraft, rules) : rules;
  return { ok: true, draft: prior ? mergeDrafts(prior, found) : found, via: fromModel ? "model+rules" : "rules", ms: model.ms, ...(fromModel ? {} : { modelError: model.error ?? "the model's answer was not a workout" }) };
}
