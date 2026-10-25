// anchor-skips.json (2026-10-25 day-plan review): the daily anchors (the gym) he gave up for one day by saying "only these two things today".
// The anchor fill (fill --anchors, run by orion-proactive when he wakes, and day --fill) never books a skipped anchor back on that day, and
// never bumps his plan to make room for it. One entry per date and anchor title; entries older than two weeks are forgotten.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { controlledDir } from "./slips.mjs";
import { sandbox } from "./bridge-path.mjs";

// Beside the undo journal when that is redirected (every test world sets ORION_RESCHEDULE_UNDO), so a test never writes the live file.
export const anchorSkipsFile = () => process.env.ORION_ANCHOR_SKIPS_FILE
  || (process.env.ORION_RESCHEDULE_UNDO ? join(dirname(process.env.ORION_RESCHEDULE_UNDO), "anchor-skips.json") : join(controlledDir(), `${sandbox() ? "eval-" : ""}anchor-skips.json`));
const read = () => { try { const v = JSON.parse(readFileSync(anchorSkipsFile(), "utf8")); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; } };
const norm = (t) => String(t).trim().toLowerCase();

/** The anchor titles skipped on that date (YYYY-MM-DD). */
export function anchorSkipsOn(date) {
  const list = read()[date];
  return Array.isArray(list) ? list.filter((t) => typeof t === "string") : [];
}

/** Records that these anchors are skipped on that date. Best effort: a skip that cannot be recorded never fails the change. */
export function skipAnchors(date, titles, now = new Date()) {
  if (!titles.length) return;
  try {
    const cutoff = new Date(now.getTime() - 14 * 86400000).toISOString().slice(0, 10);
    const all = Object.fromEntries(Object.entries(read()).filter(([d]) => d >= cutoff));
    const merged = [...new Set([...(all[date] ?? []), ...titles].map(norm))];
    const file = anchorSkipsFile();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify({ ...all, [date]: merged }, null, 2));
    renameSync(`${file}.tmp`, file);
  } catch { /* the change itself already went through */ }
}

export const anchorSkipped = (date, title, skips = anchorSkipsOn(date)) => skips.map(norm).includes(norm(title));
