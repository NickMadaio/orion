// Writing a workout into health-log.json's `workouts` (orion-workout-log --log / answer / undo).
// Same file, lock and atomic write as the food log (lib/food/log.mjs `update`) and the Orion app's WorkoutSession (HealthLog.swift):
// id, day (yyyy-MM-dd, the 4 AM cutoff), startedAt (ISO string), title, exercises [{ id, name, sets: [{ id, weight, reps, unit }] }], notes.
// The app drops fields it does not know, so what matters to a reader (minutes, cardio, effort, what was not given) is also written into `notes`.
// Added fields the app ignores: source "chat", type, durationMin, cardio, effort, skipped. Every id starts "WKT-" so undo finds exactly the entry
// this tool wrote and nothing he logged himself. Never during an evaluation (eval-mode marker).
import { randomUUID } from "node:crypto";
import { evalMode } from "../eval-mode.mjs";
import { dayKey, healthLogPath, stamp, update } from "../food/log.mjs";
import { summaryOf, titleOf, totalMinutes } from "./draft.mjs";

const lbl = (n) => String(n).replace(/\.0$/, "");
const refused = () => ({ ok: false, refused: true, error: "Not logged: ORION is in an evaluation run, so nothing is written to your health log." });

function whenOf(draft, now) {
  const dayDate = draft.day === "yesterday" ? new Date(now.getTime() - 86_400_000) : /^\d{4}-\d{2}-\d{2}$/.test(draft.day) ? new Date(`${draft.day}T12:00:00`) : now;
  const day = draft.day === "yesterday" ? dayKey(dayDate) : /^\d{4}-\d{2}-\d{2}$/.test(draft.day) ? draft.day : dayKey(now);
  const [h, m] = draft.startTime ? draft.startTime.split(":").map(Number) : [];
  const at = h !== undefined ? new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), h, m) : draft.day ? new Date(dayDate.getFullYear(), dayDate.getMonth(), dayDate.getDate(), 12, 0) : now;
  return { day, startedAt: stamp(at) };
}

const notesOf = (draft, skipped) => [
  totalMinutes(draft) ? `${lbl(totalMinutes(draft))} min` : "",
  ...draft.cardio.map((c) => [c.activity, c.machine && c.machine !== c.activity ? `on ${c.machine}` : "", c.distance ? `${lbl(c.distance)} ${c.distanceUnit || "mi"}` : "", c.minutes ? `${lbl(c.minutes)} min` : ""].filter(Boolean).join(" ")),
  draft.effort ? `effort ${lbl(draft.effort)}/10` : "", draft.notes, skipped.length ? `not given: ${skipped.join("; ")}` : "", "Logged by ORION from chat.",
].filter(Boolean).join(" · ").slice(0, 400);

/** The health-log session for a draft. */
export function entryFor(draft, { now, skipped = [], id = `WKT-${randomUUID().toUpperCase()}` }) {
  const { day, startedAt } = whenOf(draft, now);
  const title = titleOf(draft);
  return {
    id, day, startedAt, title: title.charAt(0).toUpperCase() + title.slice(1),
    exercises: draft.exercises.map((e) => ({ id: randomUUID().toUpperCase(), name: e.name,
      sets: Array.from({ length: e.reps ? e.sets || 1 : 0 }, () => ({ id: randomUUID().toUpperCase(), weight: e.weight, reps: e.reps, unit: e.unit || "lb" })) })),
    notes: notesOf(draft, skipped),
    source: "chat", type: draft.type, durationMin: totalMinutes(draft), cardio: draft.cardio, effort: draft.effort, skipped,
  };
}

/** Appends the workout. Resolves { ok, entry, summary, count } (count: sessions that day) or { ok: false, error }. */
export function logWorkout(draft, { now = new Date(), skipped = [], env = process.env } = {}) {
  if (evalMode()) return refused();
  try {
    const entry = entryFor(draft, { now, skipped });
    const count = update(healthLogPath(env), now, (log) => {
      const workouts = [...(Array.isArray(log.workouts) ? log.workouts : []), entry];
      return { next: { ...log, workouts }, result: workouts.filter((w) => w?.day === entry.day).length };
    });
    return { ok: true, entry, summary: summaryOf(draft), count };
  } catch (error) { return { ok: false, error: error.message }; }
}

/** Removes a session this tool wrote (WKT- id). A session he logged himself is never touched. */
export function undoWorkout(id, { now = new Date(), env = process.env } = {}) {
  if (evalMode()) return refused();
  if (!/^WKT-[0-9A-F-]{36}$/i.test(String(id))) return { ok: false, error: `${id} isn't a workout I logged` };
  try {
    return update(healthLogPath(env), now, (log) => {
      const workouts = Array.isArray(log.workouts) ? log.workouts : [];
      const removed = workouts.find((w) => w?.id === id);
      if (!removed) return { next: log, result: { ok: false, error: `no workout ${id} in the health log` } };
      return { next: { ...log, workouts: workouts.filter((w) => w !== removed) }, result: { ok: true, removed } };
    });
  } catch (error) { return { ok: false, error: error.message }; }
}
