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
