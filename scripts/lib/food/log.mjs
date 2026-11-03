// Writing an estimate into health-log.json's nutritionLog (orion-food-estimate --log / log-pending / undo).
// Same file, lock and entry shape as orion-log and the Orion app (HealthLog.swift NutritionEntry): integers for
// calories and grams, the day keyed with the app's 4 AM cutoff, and the day record's calorie total kept in step.
// Added fields the app ignores: source "estimate", confidence, photo/photos, estimate (the items). Every entry id
// starts "FOOD-" so `orion-food-estimate undo <id>` can find and remove exactly the one it wrote. A yes that FILLED a meal he had
// logged (target.entryId) keeps that meal's id, so its original is saved in food-undo.json and undo puts it back instead of deleting
// it (wave 14 review). The journal lives beside the log rather than in the entry: the app's NutritionEntry drops unknown fields.
// Never during an evaluation (eval-mode marker): the reply says it was not logged.
import { chmodSync, closeSync, mkdirSync, openSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";
import { controlledDir } from "../clock.mjs";
import { evalMode } from "../eval-mode.mjs";

export const healthLogPath = (env = process.env) => env.ORION_HEALTH_LOG || join(controlledDir(env), "health-log.json");
export const undoJournalPath = (env = process.env) => join(controlledDir(env), "food-undo.json");
const JOURNAL_MAX = 50;
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
export const stamp = (d) => d.toISOString().replace(/\.\d{3}Z$/, "Z");

/** The app's logical day: before 4 AM is still yesterday (OrionDay.cutoffHour). */
export const dayKey = (d) => new Date(d.getTime() - 4 * 3600_000).toLocaleDateString("en-CA");

/** What he called it wins; otherwise the clock (orion-log's bands). */
export function mealFor(said, at) {
  const named = { breakfast: "Breakfast", brunch: "Breakfast", lunch: "Lunch", dinner: "Dinner", supper: "Dinner", snack: "Snack" }[String(said ?? "").toLowerCase()];
  if (named) return named;
  const h = at.getHours();
  return h >= 4 && h < 11 ? "Breakfast" : h >= 11 && h < 15 ? "Lunch" : h >= 17 && h < 22 ? "Dinner" : "Snack";
}

function withLock(file, body) {
  const lock = `${file}.lock`; const deadline = Date.now() + 6000;
  mkdirSync(dirname(file), { recursive: true });
  for (;;) {
    try { closeSync(openSync(lock, "wx")); break; } catch (error) {
      if (error.code !== "EEXIST") throw error;
      try { if (Date.now() - statSync(lock).mtimeMs > 15000) unlinkSync(lock); } catch { /* raced: retry */ }
      if (Date.now() > deadline) throw new Error("the health log stayed busy; try again");
      sleep(20);
    }
  }
  try { return body(); } finally { try { unlinkSync(lock); } catch { /* already gone */ } }
}

/** Read, change (returning a new log), write atomically. The change gets a copy and must not throw half way. */
export function update(file, now, change) {
  return withLock(file, () => {
    let log;
    try { log = JSON.parse(readFileSync(file, "utf8")); } catch (error) {
      if (error.code !== "ENOENT") throw new Error("the health log isn't readable JSON, so nothing was written");
      log = { schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [] };
    }
    const { next, result } = change(log);
    const at = stamp(now);
    const scratch = join(dirname(file), `.health-log.${randomUUID()}.tmp`);
    writeFileSync(scratch, JSON.stringify({ ...next, updatedAt: at }, null, 2)); chmodSync(scratch, 0o600); renameSync(scratch, file);
    return result;
  });
}

/** The day record with its calorie total recomputed from that day's entries. */
function withDayTotal(log, day, entries, now) {
  const days = log.days ?? {};
  const record = { waterBottles: 0, calories: 0, supplementIDs: [], updatedAt: "", ...(days[day] ?? {}) };
  const calories = entries.reduce((a, e) => a + (Number(e.calories) || 0), 0);
  return { ...log, nutritionLog: { ...(log.nutritionLog ?? {}), [day]: entries }, days: { ...days, [day]: { ...record, calories, updatedAt: stamp(now) } } };
}

/** The nutritionLog entry for an estimate. */
export function entryFor(estimate, { meal, at, id = `FOOD-${randomUUID().toUpperCase()}`, title }) {
  const t = estimate.totals;
  const photos = estimate.input?.photos ?? [];
  const names = estimate.items.map((i) => i.name);
  const name = title || (names.length > 2 ? `${names.slice(0, 2).join(", ")} +${names.length - 2}` : names.join(" and "));
  return {
    id, title: (name.charAt(0).toUpperCase() + name.slice(1)).slice(0, 80), meal,
    calories: Math.round(t.kcal), protein: Math.round(t.p), carbohydrates: Math.round(t.c), fat: Math.round(t.f), fiber: 0,
    notes: `Estimated by ORION (${estimate.confidence} confidence)${estimate.assumptions.length ? `: ${estimate.assumptions.slice(0, 3).join("; ")}` : ""}.`.slice(0, 280),
    loggedAt: stamp(at), source: "estimate", confidence: estimate.confidence,
    ...(photos[0] ? { photo: photos[0] } : {}), ...(photos.length > 1 ? { photos } : {}),
    estimate: { items: estimate.items, assumptions: estimate.assumptions },
  };
}

/** { records: [{ id, day, before, at }] }, newest last; a broken or missing file is empty. */
function readJournal(env) {
  try { const j = JSON.parse(readFileSync(undoJournalPath(env), "utf8")); return Array.isArray(j?.records) ? j.records : []; } catch { return []; }
}
function writeJournal(records, env) {
  const file = undoJournalPath(env);
  mkdirSync(dirname(file), { recursive: true });
  const scratch = join(dirname(file), `.food-undo.${randomUUID()}.tmp`);
  writeFileSync(scratch, JSON.stringify({ records: records.slice(-JOURNAL_MAX) }, null, 2)); chmodSync(scratch, 0o600); renameSync(scratch, file);
}

const refused = () => ({ ok: false, refused: true, error: "Not logged: ORION is in an evaluation run, so nothing is written to your health log." });

/**
 Appends an estimate, or fills an existing entry (target.entryId: a meal logged earlier with 0 kcal) with its numbers.
 target.replace: the entry is one this tool wrote and Nick corrected; it is rewritten in place (new title and numbers, same id) and not journaled,
 so undo removes it instead of restoring the first guess.
 Resolves { ok, entry, day, dayCalories } / { ok: false, error }.
*/
export function logEstimate(estimate, { meal, at, now = at, target, env = process.env } = {}) {
  if (evalMode()) return refused();
  const file = healthLogPath(env);
  try {
    const out = update(file, now, (log) => {
      const located = target?.entryId ? locate(log, target.entryId) : null;
      const day = located?.day ?? dayKey(at);
      const existing = log.nutritionLog?.[day] ?? [];
      const prior = located ? existing[located.index] : null;
      const entry = prior && target.replace
        ? entryFor(estimate, { meal: prior.meal ?? meal, at: new Date(prior.loggedAt ?? at), id: prior.id })
        : prior
        ? { ...entryFor(estimate, { meal: prior.meal ?? meal, at: new Date(prior.loggedAt ?? at), id: prior.id, title: prior.title }), notes: [prior.notes, entryFor(estimate, { meal, at }).notes].filter(Boolean).join(" ") }
        : entryFor(estimate, { meal: mealFor(meal, at), at });
      const entries = prior ? existing.map((e, i) => (i === located.index ? entry : e)) : [...existing, entry];
      const next = withDayTotal(log, day, entries, now);
      return { next, result: { ok: true, entry, day, filled: !!prior, before: prior, dayCalories: next.days[day].calories } };
    });
    if (out.ok && out.before && !target?.replace) writeJournal([...readJournal(env).filter((r) => r.id !== out.entry.id), { id: out.entry.id, day: out.day, before: out.before, at: stamp(now) }], env);
    const { before: _before, ...result } = out;
    return result;
  } catch (error) { return { ok: false, error: error.message }; }
}

function locate(log, id) {
  for (const [day, entries] of Object.entries(log.nutritionLog ?? {})) {
    const index = (entries ?? []).findIndex((e) => e?.id === id);
    if (index >= 0) return { day, index };
  }
  return null;
}

/**
 Undoes what this tool did to an entry: a meal it filled goes back to how it was (food-undo.json); an entry it wrote (FOOD- id) is
 removed. Anything else is refused: undo never deletes a meal he logged himself.
*/
export function undoEntry(id, { now = new Date(), env = process.env } = {}) {
  if (evalMode()) return refused();
  const journal = readJournal(env);
  const record = journal.findLast((r) => r.id === String(id));
  if (record) return restoreEntry(record, { now, env, journal });
  if (!/^FOOD-[0-9A-F-]{36}$/i.test(String(id))) return { ok: false, error: `${id} isn't an estimate entry I wrote` };
  try {
    return update(healthLogPath(env), now, (log) => {
      const found = locate(log, id);
      if (!found) return { next: log, result: { ok: false, error: `no entry ${id} in the health log` } };
      const entries = log.nutritionLog[found.day].filter((_, i) => i !== found.index);
      const removed = log.nutritionLog[found.day][found.index];
      const next = withDayTotal(log, found.day, entries, now);
      return { next, result: { ok: true, removed, day: found.day, dayCalories: next.days[found.day].calories } };
    });
  } catch (error) { return { ok: false, error: error.message }; }
}

/** Puts a filled meal back to its saved original, then forgets the record (a second undo has nothing to restore). */
function restoreEntry(record, { now, env, journal }) {
  try {
    const out = update(healthLogPath(env), now, (log) => {
      const found = locate(log, record.id);
      if (!found) return { next: log, result: { ok: false, error: `no entry ${record.id} in the health log` } };
      const entries = log.nutritionLog[found.day].map((e, i) => (i === found.index ? record.before : e));
      const next = withDayTotal(log, found.day, entries, now);
      return { next, result: { ok: true, restored: true, entry: record.before, removed: log.nutritionLog[found.day][found.index], day: found.day, dayCalories: next.days[found.day].calories } };
    });
    if (out.ok) writeJournal(journal.filter((r) => r !== record), env);
    return out;
  } catch (error) { return { ok: false, error: error.message }; }
}

/** The newest entry from the last few hours that has no calories (a meal logged from chat), for "how many calories was that". */
export function latestUncounted({ now = new Date(), withinMs = 4 * 3600_000, env = process.env } = {}) {
  let log;
  try { log = JSON.parse(readFileSync(healthLogPath(env), "utf8")); } catch { return null; }
  const rows = [dayKey(now), dayKey(new Date(now.getTime() - 86_400_000))].flatMap((d) => log.nutritionLog?.[d] ?? []);
  return rows.filter((e) => !(Number(e.calories) > 0) && now.getTime() - Date.parse(e.loggedAt) <= withinMs && Date.parse(e.loggedAt) <= now.getTime() + 60_000)
    .sort((a, b) => Date.parse(b.loggedAt) - Date.parse(a.loggedAt))[0] ?? null;
}
