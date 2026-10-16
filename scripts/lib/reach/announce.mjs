// One key per announced event, shared by every system that might say it (2026-10-16 audit, finding 11).
// 2026-10-15: CS1800 was announced by orion-proactive ("Leave in 12 min"), orion-watch (10-minute reminder)
// and orion-standing (Discord "Heads up ... Starts in 1h 58m"). Whoever says it first marks `class-<start>`;
// the others check before they speak.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join } from "node:path";

const file = (dir) => join(dir, "announced.json");
const read = (dir) => { try { return JSON.parse(readFileSync(file(dir), "utf8")); } catch { return {}; } };

/** The owner that announced `key` on `date`, or null. */
export function announced(dir, date, key) { return read(dir)[date]?.[key] ?? null; }

export function markAnnounced(dir, date, key, owner) {
  const all = read(dir);
  if (all[date]?.[key]) return;
  mkdirSync(dir, { recursive: true });
  const keep = Object.fromEntries(Object.entries({ ...all, [date]: { ...(all[date] ?? {}), [key]: owner } }).sort().slice(-7));
  writeFileSync(`${file(dir)}.tmp`, JSON.stringify(keep, null, 2));
  renameSync(`${file(dir)}.tmp`, file(dir));
}
