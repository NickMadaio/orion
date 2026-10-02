// Calendar identities explicitly placed by Nick survive subsequent cascades.
import { readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { sandbox } from "./bridge-path.mjs";
export const pinsFile = () => process.env.ORION_RESCHEDULE_PINS || join(homedir(), `.openclaw/orion-controlled/${sandbox() ? "eval-" : ""}pins.json`);
export function readPins() {
  try { return JSON.parse(readFileSync(pinsFile(), "utf8")); }
  catch (e) { if (e.code === "ENOENT") return {}; throw e; }
}
export function savePins(pins) {
  const file = pinsFile(); mkdirSync(dirname(file), { recursive: true });
  writeFileSync(`${file}.tmp`, JSON.stringify(pins, null, 2), { mode: 0o600 }); renameSync(`${file}.tmp`, file);
}
export function pinBlocks(blocks, date) {
  const ids = new Set(readPins()[date] ?? []);
  return blocks.map(b => ids.has(b.calendarId) && !b.fixed ? { ...b, fixed: true, pinned: true } : b);
}
