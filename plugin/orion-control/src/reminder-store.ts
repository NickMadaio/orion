/*
 The reminder store, changed safely (w19-reminders). The plugin sets and cancels reminders; the app's clock and
 `orion-reminders` (scripts/lib/reminders/store.mjs) fire them and write the fired mark back. Everyone takes the
 same lock directory (`reminders.json.lock`) and writes by atomic rename, so a reminder set while a tick is running
 is never lost, and a tick never undoes a cancel.
*/
import { mkdir, rmdir, stat } from "node:fs/promises";
import { readReminders, writeReminders, type Reminder } from "./ambient.js";

const LOCK_STALE_MS = 10_000;
/** A fired one-off stays this long so "done" and "snooze" still find it (same number as the script side). */
export const KEEP_FIRED_MS = 3 * 3600_000;
const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export async function withReminderLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`;
  await mkdir(file.replace(/[^/]+$/, ""), { recursive: true }).catch(() => undefined);
  let have = false;
  for (let i = 0; i < 100 && !have; i++) {
    try { await mkdir(lock); have = true; } catch {
      try { if (Date.now() - (await stat(lock)).mtimeMs > LOCK_STALE_MS) await rmdir(lock); } catch { /* released meanwhile */ }
      await sleep(20);
    }
  }
  try { return await fn(); } finally { if (have) await rmdir(lock).catch(() => undefined); }
}

/** Read, change (return the new list, or undefined for no change) and write back, under the lock. */
export async function updateReminders(file: string, fn: (list: Reminder[]) => Reminder[] | undefined): Promise<Reminder[]> {
  return withReminderLock(file, async () => {
    const before = await readReminders(file);
    const after = fn(before);
    if (!after) return before;
    await writeReminders(file, after);
    return after;
  });
}

const touched = (r: Reminder) => Math.max(Number.isFinite(r.firedAt) ? (r.firedAt as number) : 0, Number.isFinite(r.snoozedAt) ? (r.snoozedAt as number) : 0);

/** The reminder most recently delivered (or snoozed) in the last three hours: what "done" and "snooze" mean. */
export function latestFired(list: Reminder[], now: Date | number): Reminder | null {
  const t = now instanceof Date ? now.getTime() : now;
  return list.filter((r) => touched(r) > 0 && t - touched(r) >= 0 && t - touched(r) <= KEEP_FIRED_MS).sort((a, b) => touched(b) - touched(a))[0] ?? null;
}

const pick = (list: Reminder[], key: string, now: Date) => (key === "last" || !key ? latestFired(list, now) : list.find((r) => r.id === key) ?? null);

export type SnoozeResult = { ok: true; reminder: Reminder; dueAt: number } | { ok: false; reason: string };
export async function snoozeReminder(file: string, key: string, minutes: number, now = new Date()): Promise<SnoozeResult> {
  const n = Math.round(Number(minutes));
  if (!(n >= 1 && n <= 24 * 60)) return { ok: false, reason: "that is not a snooze time" };
  const t = now.getTime();
  let result: SnoozeResult = { ok: false, reason: "nothing fired lately to snooze" };
  await updateReminders(file, (list) => {
    const found = pick(list, key, now);
    if (!found) return undefined;
    const answered: Reminder = { ...found, open: null, nudged: true };
    if (found.repeat) {
      const copy: Reminder = { id: `${found.id.slice(0, 4)}s${t.toString(36).slice(-4)}`, kind: "alarm", label: found.label, dueAt: t + n * 60_000, createdAt: t,
        ...(found.important ? { important: true } : {}), snoozedFrom: found.id };
      result = { ok: true, reminder: copy, dueAt: copy.dueAt };
      return [...list.map((r) => (r.id === found.id ? answered : r)), copy];
    }
    const moved: Reminder = { ...answered, dueAt: t + n * 60_000, firedAt: null, attempts: 0, snoozedAt: t };
    result = { ok: true, reminder: moved, dueAt: moved.dueAt };
    return list.map((r) => (r.id === found.id ? moved : r));
  });
  return result;
}

export type DoneResult = { ok: true; reminder: Reminder; recurring: boolean } | { ok: false; reason: string };
export async function doneReminder(file: string, key: string, now = new Date()): Promise<DoneResult> {
  let result: DoneResult = { ok: false, reason: "nothing fired lately to mark done" };
  await updateReminders(file, (list) => {
    const found = pick(list, key, now);
    if (!found) return undefined;
    result = { ok: true, reminder: found, recurring: !!found.repeat };
    return found.repeat ? list.map((r) => (r.id === found.id ? { ...r, open: null, nudged: true } : r)) : list.filter((r) => r.id !== found.id);
  });
  return result;
}
