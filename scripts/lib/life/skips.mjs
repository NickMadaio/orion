// Occurrences he said he is skipping that ORION cannot remove from the calendar
// itself (a read-only class calendar), 2026-10-06. Planning treats them as gone.
import { readFileSync, writeFileSync, mkdirSync, renameSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { sandbox } from "./bridge-path.mjs";

const file = () => process.env.ORION_SKIPS_FILE
  || join(homedir(), `.openclaw/orion-controlled/${sandbox() ? "eval-" : ""}skipped-events.json`);
const read = () => { try { return JSON.parse(readFileSync(file(), "utf8")); } catch { return []; } };
const write = (list) => { mkdirSync(dirname(file()), { recursive: true }); writeFileSync(`${file()}.tmp`, JSON.stringify(list, null, 2)); renameSync(`${file()}.tmp`, file()); };
const key = (title, start) => `${String(title).trim().toLowerCase()}|${new Date(start).toISOString()}`;

export function isSkipped(event, list = read()) {
  return list.some((s) => key(s.title, s.start) === key(event.title, event.start));
}
export function addSkip(title, start) {
  const list = read().filter((s) => new Date(s.start) > new Date(Date.now() - 14 * 86400000));   // forget old ones
  if (!isSkipped({ title, start }, list)) write([...list, { title, start: new Date(start).toISOString() }]);
}
export function removeSkip(title, start) {
  write(read().filter((s) => key(s.title, s.start) !== key(title, start)));
}
