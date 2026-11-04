import { updateReminders } from "../reminders/store.mjs";
// The fix offers ORION has made about his own mistakes (selffix.json in the controlled dir). One file, written atomically; the plugin
// reads it (selffix-store.ts) and only scripts/orion-selffix writes it.
//   status: candidate (the nightly scan found it, nothing said yet) | offered (asked "now or later?") | parked (project made, waiting)
//           | started (running) | declined (he said no) | done
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

export const OPEN = ["candidate", "offered", "parked", "started"];
export const DECLINE_MEMORY_MS = 7 * 86_400_000;
export const statePath = (dir) => join(dir, "selffix.json");

export function readState(dir) {
  try {
    const s = JSON.parse(readFileSync(statePath(dir), "utf8"));
    return { version: 1, items: Array.isArray(s.items) ? s.items : [], lastOfferDay: s.lastOfferDay ?? null };
  } catch { return { version: 1, items: [], lastOfferDay: null }; }
}

export function writeState(dir, state) {
  const file = statePath(dir);
  mkdirSync(dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(tmp, file);
}

export const newId = (items) => { for (;;) { const id = `sf-${randomBytes(3).toString("hex")}`; if (!items.some((i) => i.id === id)) return id; } };

/** The item that already covers this issue: an open one, or one he declined in the last week (so it is not asked again). */
export function blockingItem(items, signature, now) {
  return items.find((i) => i.signature === signature && (OPEN.filter((s) => s !== "candidate").includes(i.status)
    || (i.status === "declined" && now - Date.parse(i.decidedAt ?? 0) < DECLINE_MEMORY_MS)));
}

/** A copy of the state with one item replaced (immutable update). */
export const withItem = (state, item) => ({ ...state, items: state.items.map((i) => (i.id === item.id ? item : i)) });

/** Writes a reminder into the one reminders.json (lib/reminders/store.mjs: locked, so it never races the clock or the plugin). Returns the id. */
export function addReminder(dir, { label, dueAt, now }) {
  let id = "";
  updateReminders(dir, (live) => {
    let stamp = now;
    while (live.some((r) => r.id === `f${stamp.toString(36).slice(-5)}`)) stamp += 1;
    id = `f${stamp.toString(36).slice(-5)}`;
    return [...live, { id, kind: "alarm", label, dueAt, createdAt: now }];
  });
  return id;
}

export function dropReminder(dir, id) {
  if (!id) return;
  updateReminders(dir, (live) => (live.some((r) => r.id === id) ? live.filter((r) => r.id !== id) : undefined));
}

/** This evening at 19:30 local, or tomorrow's once it is past 19:00. */
export function nextEvening(now) {
  const at = new Date(now);
  at.setHours(19, 30, 0, 0);
  if (now.getTime() >= at.getTime() - 30 * 60_000) at.setDate(at.getDate() + 1);
  return at;
}

const alive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
export const LOCK_STALE_MS = 2 * 60_000;

/** One action at a time on the fix offers (selffix.lock, a directory: mkdir is atomic). A lock whose owner is gone or over 2 minutes old is taken over. Returns a release function, or null when another action holds it. */
export function acquireLock(dir) {
  const lock = join(dir, "selffix.lock");
  mkdirSync(dir, { recursive: true });
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      mkdirSync(lock);
      writeFileSync(join(lock, "owner"), JSON.stringify({ pid: process.pid, at: Date.now() }));
      return () => { try { rmSync(lock, { recursive: true, force: true }); } catch { /* already gone */ } };
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      let owner = {};
      try { owner = JSON.parse(readFileSync(join(lock, "owner"), "utf8")); } catch { /* being written, or unreadable */ }
      let age = 0;
      try { age = Date.now() - statSync(lock).mtimeMs; } catch { /* gone: retry */ }
      const stale = age > LOCK_STALE_MS || (Number.isInteger(owner.pid) && !alive(owner.pid));
      if (!stale) return null;
      rmSync(lock, { recursive: true, force: true });
    }
  }
  return null;
}
