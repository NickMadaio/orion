// The fix offers ORION has made about his own mistakes (selffix.json in the controlled dir). One file, written atomically; the plugin
// reads it (selffix-store.ts) and only scripts/orion-selffix writes it.
//   status: candidate (the nightly scan found it, nothing said yet) | offered (asked "now or later?") | parked (project made, waiting)
//           | started (running) | declined (he said no) | done
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
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

/** Writes a reminder in the shape the Mac app polls (reminders.json: id, kind, label, dueAt, createdAt). Returns the id. */
export function addReminder(dir, { label, dueAt, now }) {
  const file = join(dir, "reminders.json");
  let live = [];
  try { const parsed = JSON.parse(readFileSync(file, "utf8")); if (Array.isArray(parsed)) live = parsed; } catch { /* none yet */ }
  let stamp = now;
  while (live.some((r) => r.id === `f${stamp.toString(36).slice(-5)}`)) stamp += 1;
  const reminder = { id: `f${stamp.toString(36).slice(-5)}`, kind: "alarm", label, dueAt, createdAt: now };
  const tmp = `${file}.${process.pid}.tmp`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(tmp, JSON.stringify([...live, reminder], null, 2), { mode: 0o600 });
  renameSync(tmp, file);
  return reminder.id;
}

export function dropReminder(dir, id) {
  const file = join(dir, "reminders.json");
  if (!id || !existsSync(file)) return;
  try {
    const live = JSON.parse(readFileSync(file, "utf8"));
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(live.filter((r) => r.id !== id), null, 2), { mode: 0o600 });
    renameSync(tmp, file);
  } catch { /* an unreadable reminder file is left alone */ }
}

/** This evening at 19:30 local, or tomorrow's once it is past 19:00. */
export function nextEvening(now) {
  const at = new Date(now);
  at.setHours(19, 30, 0, 0);
  if (now.getTime() >= at.getTime() - 30 * 60_000) at.setDate(at.getDate() + 1);
  return at;
}
