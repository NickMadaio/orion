// What the model must return for a workout, and what is done when it does not quite (orion-workout-log).
//   draft = { type, title, day, startTime, durationMin, exercises: [{ name, sets, reps, weight, unit }],
//             cardio: [{ activity, machine, minutes, distance, distanceUnit }], sport, effort, notes }
// Unknown is 0 or "" (a structured-output schema stays simple that way); nothing downstream treats 0 as a real value.
// The model's numbers are held to the words: a set, rep, weight or minute count the description never contained is dropped, so a
// guessed "3x10 at 135" can never be logged as something he said.
import { numbersIn } from "./rules.mjs";

export const TYPES = ["strength", "cardio", "sport", "mixed", "unknown"];
export const LIMITS = { sets: 20, reps: 200, weight: 1500, minutes: 600, distance: 200, exercises: 25, cardio: 6, name: 60, notes: 240 };

export const WORKOUT_JSON_SCHEMA = {
  type: "object",
  properties: {
    type: { type: "string", enum: TYPES }, title: { type: "string" }, day: { type: "string" }, startTime: { type: "string" },
    durationMin: { type: "number" }, sport: { type: "string" }, effort: { type: "number" }, notes: { type: "string" },
    exercises: { type: "array", items: { type: "object", properties: {
      name: { type: "string" }, sets: { type: "number" }, reps: { type: "number" }, weight: { type: "number" }, unit: { type: "string", enum: ["lb", "kg", ""] } },
      required: ["name", "sets", "reps", "weight", "unit"] } },
    cardio: { type: "array", items: { type: "object", properties: {
      activity: { type: "string" }, machine: { type: "string" }, minutes: { type: "number" }, distance: { type: "number" }, distanceUnit: { type: "string", enum: ["mi", "km", ""] } },
      required: ["activity", "machine", "minutes", "distance", "distanceUnit"] } },
  },
  required: ["type", "title", "day", "startTime", "durationMin", "exercises", "cardio", "sport", "effort", "notes"],
};

const num = (v) => (typeof v === "number" ? v : typeof v === "string" ? Number.parseFloat(v) : Number.NaN);
const within = (v, max) => (Number.isFinite(v) && v > 0 && v <= max ? Math.round(v * 10) / 10 : 0);
const text = (v, max) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);

/** The first JSON object in the model's text (fenced or bare), or null. */
export function extractJson(raw) {
  const s = String(raw ?? "");
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(s)?.[1];
  for (const candidate of [fenced, s]) {
    if (!candidate) continue;
    const start = candidate.indexOf("{"), end = candidate.lastIndexOf("}");
    if (start < 0 || end <= start) continue;
    try { return JSON.parse(candidate.slice(start, end + 1)); } catch { /* try the next */ }
  }
  return null;
}

export const emptyDraft = () => ({ type: "unknown", title: "", day: "", startTime: "", durationMin: 0, exercises: [], cardio: [], sport: "", effort: 0, notes: "" });

/** strength / cardio / mixed / sport from what is in the draft. */
export function kindOf(exercises, cardio, sport) {
  return exercises.length && cardio.length ? "mixed" : exercises.length ? "strength" : cardio.length ? "cardio" : sport ? "sport" : "unknown";
}

/** A model object (or any object) as a clean draft: clamped, names trimmed, numbers kept only when `said` contained them. Null when it is not an object. */
export function cleanDraft(raw, said) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const heard = numbersIn(said);
  const keep = (v, max) => { const n = within(num(v), max); return n && (heard.has(n) || heard.has(Math.round(n))) ? n : 0; };
  const exercises = (Array.isArray(raw.exercises) ? raw.exercises : []).slice(0, LIMITS.exercises).map((e) => {
    const name = text(e?.name, LIMITS.name);
    if (!name) return null;
    const weight = keep(e.weight, LIMITS.weight), reps = keep(e.reps, LIMITS.reps);
    const sets = keep(e.sets, LIMITS.sets) || (reps && num(e.sets) === 1 ? 1 : 0);   // one set needs no "1" in his words ("deadlift 225x5")
    return { name, sets, reps: reps, weight, unit: weight ? (/^kg/i.test(String(e.unit)) ? "kg" : "lb") : "" };
  }).filter(Boolean);
  const cardio = (Array.isArray(raw.cardio) ? raw.cardio : []).slice(0, LIMITS.cardio).map((c) => {
    const activity = text(c?.activity, LIMITS.name).toLowerCase(), machine = text(c?.machine, LIMITS.name).toLowerCase();
    if (!activity && !machine) return null;
    const distance = keep(c.distance, LIMITS.distance);
    return { activity: activity || machine, machine, minutes: keep(c.minutes, LIMITS.minutes), distance, distanceUnit: distance ? (/^k/i.test(String(c.distanceUnit)) ? "km" : "mi") : "" };
  }).filter(Boolean);
  const type = TYPES.includes(raw.type) ? raw.type : "unknown";
  const day = /^(?:yesterday|\d{4}-\d{2}-\d{2})$/.test(String(raw.day)) ? String(raw.day) : "";
  const startTime = /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(String(raw.startTime)) ? String(raw.startTime) : "";
  const sport = text(raw.sport, 30).toLowerCase();
  return { type: type === "unknown" ? kindOf(exercises, cardio, sport) : type, title: text(raw.title, 40).toLowerCase(), day, startTime,
    durationMin: keep(raw.durationMin, LIMITS.minutes), exercises, cardio, sport, effort: keep(raw.effort, 10), notes: text(raw.notes, LIMITS.notes) };
}
