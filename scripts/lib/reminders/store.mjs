// reminders.json from the script side (w19-reminders). The plugin writes it when he asks for a reminder, the app and
// orion-reminders update it as they fire. Both sides take the same lock directory and write by atomic rename, so a
// set that lands while a tick is running is never lost.
import { readFileSync, writeFileSync, renameSync, mkdirSync, rmdirSync, statSync } from "node:fs";
import { join } from "node:path";

export const FILE = "reminders.json";
const LOCK_STALE_MS = 10_000;
/** A fired one-off stays this long so "done" and "snooze" still find it. */
export const KEEP_FIRED_MS = 3 * 3600_000;

export function readReminders(dir) {
  try {
    const parsed = JSON.parse(readFileSync(join(dir, FILE), "utf8"));
    return Array.isArray(parsed) ? parsed.filter((r) => r && typeof r.id === "string" && Number.isFinite(r.dueAt)) : [];
  } catch { return []; }
}

const sleep = (ms) => { try { Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms); } catch { /* no wait available: spin once */ } };

/** Run `fn` holding the store lock (the plugin uses the same directory name). */
export function withLock(dir, fn) {
  const lock = join(dir, `${FILE}.lock`);
  mkdirSync(dir, { recursive: true });
  let have = false;
  for (let i = 0; i < 100 && !have; i++) {
    try { mkdirSync(lock); have = true; } catch {
      try { if (Date.now() - statSync(lock).mtimeMs > LOCK_STALE_MS) rmdirSync(lock); } catch { /* released meanwhile */ }
      sleep(20);
    }
  }
  try { return fn(); } finally { if (have) { try { rmdirSync(lock); } catch { /* already gone */ } } }
}

/** Read, change (fn returns the new list, or undefined for no change), and write back, under the lock. */
export function updateReminders(dir, fn) {
  return withLock(dir, () => {
    const before = readReminders(dir);
    const after = fn(before);
    if (!after) return before;
    const file = join(dir, FILE);
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(after, null, 2), "utf8");
    renameSync(tmp, file);
    return after;
  });
}

/** The reminder most recently delivered (or snoozed) within the last three hours: what "done" and "snooze" mean. */
export function latestFired(list, now) {
  const t = now instanceof Date ? now.getTime() : Number(now);
  const touched = (r) => Math.max(Number.isFinite(r.firedAt) ? r.firedAt : 0, Number.isFinite(r.snoozedAt) ? r.snoozedAt : 0);
  return list.filter((r) => touched(r) > 0 && t - touched(r) >= 0 && t - touched(r) <= KEEP_FIRED_MS)
    .sort((a, b) => touched(b) - touched(a))[0] ?? null;
}

const pick = (list, key, now) => (key === "last" || !key ? latestFired(list, now) : list.find((r) => r.id === key) ?? null);

/** Snooze: a one-off moves to now + minutes; a recurring one keeps its schedule and gets a one-off copy. */
export function snoozeReminder(dir, key, minutes, now = new Date()) {
  const n = Math.round(Number(minutes));
  if (!(n >= 1 && n <= 24 * 60)) return { ok: false, reason: "that is not a snooze time" };
  const t = now.getTime();
  let found = null, copy = null;
  updateReminders(dir, (list) => {
    found = pick(list, key, now);
    if (!found) return undefined;
    const answered = { ...found, open: null, nudged: true };
    if (found.repeat) {
      copy = { id: `${found.id.slice(0, 4)}s${t.toString(36).slice(-4)}`, kind: "alarm", label: found.label, dueAt: t + n * 60_000, createdAt: t,
        ...(found.important ? { important: true } : {}), snoozedFrom: found.id };
      return [...list.map((r) => (r.id === found.id ? answered : r)), copy];
    }
    copy = { ...answered, dueAt: t + n * 60_000, firedAt: null, attempts: 0, snoozedAt: t };
    return list.map((r) => (r.id === found.id ? copy : r));
  });
  return found ? { ok: true, reminder: copy, dueAt: copy.dueAt } : { ok: false, reason: "nothing fired lately to snooze" };
}

/** Done: a one-off goes; a recurring one stays scheduled and stops asking about this occurrence. */
export function doneReminder(dir, key, now = new Date()) {
  let found = null;
  updateReminders(dir, (list) => {
    found = pick(list, key, now);
    if (!found) return undefined;
    return found.repeat ? list.map((r) => (r.id === found.id ? { ...r, open: null, nudged: true } : r)) : list.filter((r) => r.id !== found.id);
  });
  return found ? { ok: true, reminder: found } : { ok: false, reason: "nothing fired lately to mark done" };
}

const dayOf = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`; };

/** What is still to come today, in time order (a place reminder counts until it fires); fired ones are not "to come". */
export function todaysReminders(list, now) {
  return list.filter((r) => (r.repeat || !Number.isFinite(r.firedAt)) && (r.place || dayOf(r.dueAt) === dayOf(now.getTime())) && (r.place || r.dueAt >= now.getTime() - 120_000))
    .sort((a, b) => a.dueAt - b.dueAt);
}
