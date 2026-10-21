// orion-written.json (live run 5, 2026-10-21): the calendar identifiers of the blocks ORION created. An ORION block is movable whatever
// calendar it sits in and whether or not its [orion:kind] marker survived (blocks written to the School feed before the eventCalendar
// change lost theirs, and were then treated as his own fixed plans). Only events ORION did not write stay fixed.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { controlledDir } from "./slips.mjs";
import { sandbox } from "./bridge-path.mjs";

// Beside the undo journal when that is redirected (every test world sets ORION_RESCHEDULE_UNDO), so a test never writes the live ledger.
export const writtenFile = () => process.env.ORION_WRITTEN_FILE
  || (process.env.ORION_RESCHEDULE_UNDO ? join(dirname(process.env.ORION_RESCHEDULE_UNDO), "orion-written.json") : join(controlledDir(), `${sandbox() ? "eval-" : ""}orion-written.json`));
const CAP = 2000;

export function writtenIdentifiers() {
  try { const list = JSON.parse(readFileSync(writtenFile(), "utf8")); return new Set(Array.isArray(list) ? list.filter((x) => typeof x === "string") : []); } catch { return new Set(); }
}

/** Adds identifiers ORION just created (never his own plans). Best effort: a write that cannot be recorded never fails the change. */
export function recordWritten(ids) {
  const add = ids.filter((x) => typeof x === "string" && x);
  if (!add.length) return;
  try {
    const file = writtenFile();
    const list = [...writtenIdentifiers(), ...add].filter((x, i, all) => all.indexOf(x) === i).slice(-CAP);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(list));
    renameSync(`${file}.tmp`, file);
  } catch { /* ledger only */ }
}

/**
 * `orion-reschedule ledger backfill` (review of 7d5f393): the identifiers of events ORION made, on HARD evidence only —
 *   journal  a create step in the undo journal (reschedule-undo.json)
 *   created  orion-created-events.json (the Mac app's record of what it created)
 *   pin      pins.json (ORION pins only blocks it placed)
 *   tag      the [orion:kind] marker ORION writes into an event's notes
 * No title counts. Returns each id with every reason it has.
 */
export function backfillEvidence({ events, journal = [], created = [], pins = {} }) {
  const reasons = new Map();
  const add = (id, why) => { if (typeof id === "string" && id) reasons.set(id, [...new Set([...(reasons.get(id) ?? []), why])]); };
  for (const entry of Array.isArray(journal) ? journal : []) for (const step of entry?.steps ?? []) if (step?.op === "create") add(step.identifier, "journal");
  // The app records EventKit eventIdentifiers ("<calendar>:<uuid>"); the bridge lists calendarItemIdentifiers. Only an exact match, or the
  // record's own uuid part equal to an event's id, is evidence.
  const createdSet = new Set((Array.isArray(created) ? created : []).flatMap((c) => (typeof c === "string" ? [c, c.split(":").at(-1)] : [])));
  for (const e of events) if (createdSet.has(e.identifier)) add(e.identifier, "created");
  for (const ids of Object.values(pins ?? {})) for (const id of Array.isArray(ids) ? ids : []) add(id, "pin");
  for (const e of events) if (e.orion) add(e.identifier, "tag");
  return reasons;
}
