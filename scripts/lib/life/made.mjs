// orion-made.json (w20 round 3): the calendar identifiers of EVERYTHING ORION created, including a plan with people ("call with mum") that
// stays fixed for the planner. orion-written.json (written.mjs) is only the movable blocks, because listing a fixed plan there would make
// the planner move it. This list changes nothing about planning: it only answers "did ORION make this?", so "take the call with mum off my
// day" removes the block ORION booked (and "skip" on it removes it) while his own event of the same name is never deleted.
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { controlledDir } from "./slips.mjs";
import { sandbox } from "./bridge-path.mjs";

export const madeFile = () => process.env.ORION_MADE_FILE
  || (process.env.ORION_RESCHEDULE_UNDO ? join(dirname(process.env.ORION_RESCHEDULE_UNDO), "orion-made.json") : join(controlledDir(), `${sandbox() ? "eval-" : ""}orion-made.json`));
const CAP = 2000;

export function madeIdentifiers() {
  try { const list = JSON.parse(readFileSync(madeFile(), "utf8")); return new Set(Array.isArray(list) ? list.filter((x) => typeof x === "string") : []); } catch { return new Set(); }
}

/** Best effort: a ledger that cannot be written never fails the change. */
export function recordMade(ids) {
  const add = ids.filter((x) => typeof x === "string" && x);
  if (!add.length) return;
  try {
    const file = madeFile();
    const list = [...madeIdentifiers(), ...add].filter((x, i, all) => all.indexOf(x) === i).slice(-CAP);
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(`${file}.tmp`, JSON.stringify(list));
    renameSync(`${file}.tmp`, file);
  } catch { /* ledger only */ }
}
