// logged.jsonl (2026-10-19): what he told ORION he really did, kept apart from the calendar. `orion-reschedule log` writes the
// block into Apple Calendar AND one row here. The calendar alone is not enough to know a block is "logged":
//   - the Mac bridge deployed on 2026-10-19 was the 10-06 build, which drops the `logged` tag (orionTags) on write and read, and
//   - a block can be removed from the calendar afterwards (tonight's `cs lab` and Gym were gone from it within the hour).
// The nightly review and the blank asks read this ledger, so "Nothing logged today" can no longer be said over a log he made.
// One JSON object per line: { date, txn, identifier, title, kind, start, end (minutes), at }.
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { controlledDir } from "./slips.mjs";

export const loggedFile = () => join(controlledDir(), "logged.jsonl");

export function readLogged(date) {
  try {
    const rows = readFileSync(loggedFile(), "utf8").split("\n").flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });
    return date ? rows.filter((r) => r.date === date) : rows;
  } catch { return []; }
}

/** @param rows [{ date, txn, identifier, title, kind, start, end }] */
export function appendLogged(rows) {
  if (!rows.length) return;
  const file = loggedFile();
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, rows.map((r) => `${JSON.stringify({ at: new Date().toISOString(), ...r })}\n`).join(""));
}

/** "undo" takes the log back, so its rows go with it. */
export function removeLogged(txn) {
  if (!txn) return;
  const file = loggedFile();
  try {
    const kept = readLogged().filter((r) => r.txn !== txn);
    writeFileSync(`${file}.tmp`, kept.map((r) => `${JSON.stringify(r)}\n`).join(""));
    renameSync(`${file}.tmp`, file);
  } catch { /* nothing logged yet */ }
}

export const loggedIdentifiers = () => new Set(readLogged().map((r) => r.identifier).filter(Boolean));

/** Events the ledger knows are logged get the `logged` tag, whatever the bridge returned (an old bridge returns none). */
export function markLoggedEvents(events, ids = loggedIdentifiers()) {
  if (!ids.size) return events;
  return events.map((e) => {
    if (!ids.has(e.identifier)) return e;
    const have = Array.isArray(e.orionTags) ? e.orionTags : String(e.orionTags ?? "").split(",").map((t) => t.trim()).filter(Boolean);
    return have.includes("logged") ? e : { ...e, orionTags: [...(have.length ? have : e.orion ? [e.orion] : []), "logged"].join(",") };
  });
}

const norm = (t) => String(t ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const overlap = (a, b) => Math.min(a.end, b.end) - Math.max(a.start, b.start);

/**
 * The day for READERS (the review, the blank asks): the calendar's blocks plus every logged row the calendar no longer shows.
 * A ledger row is shown only when no calendar block has its identifier and none of the same title covers half of it.
 * Planning never reads these: they carry no calendar id, so nothing can move or delete them.
 */
export function withLoggedLedger(blocks, date, rows = readLogged(date)) {
  const extra = rows.filter((r) => Number.isInteger(r.start) && Number.isInteger(r.end) && r.end > r.start
    && !blocks.some((b) => (r.identifier && b.calendarId === r.identifier) || (norm(b.title) === norm(r.title) && overlap(b, r) * 2 >= r.end - r.start)))
    .map((r, i) => ({ id: `ledger-${r.txn ?? i}-${i}`, title: r.title, kind: r.kind ?? "other", date, start: r.start, end: r.end, fixed: false, source: "orion",
      calendarId: null, tags: ["logged"], logged: true, ledgerOnly: true }));
  return extra.length ? [...blocks, ...extra].sort((a, b) => a.start - b.start) : blocks;
}
