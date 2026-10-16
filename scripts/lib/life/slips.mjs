// slips.jsonl (C10): what the plan said and reality did not do. The calendar keeps no trace of a
// replaced plan; the nightly review reads this file. One JSON object per line.
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync, closeSync, openSync, utimesSync } from "node:fs";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { sandbox } from "./bridge-path.mjs";

export const controlledDir = () => process.env.ORION_CONTROLLED_DIR || join(homedir(), ".openclaw/orion-controlled");
export const slipsFile = () => join(controlledDir(), "slips.jsonl");

/** @param rows [{ date, at, planned: {title,start,end,kind,rank}, missedMinutes, replacedBy, reason, txn? }] */
export function appendSlips(rows) {
  if (!rows.length) return;
  const file = slipsFile();
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, rows.map((r) => `${JSON.stringify(r)}\n`).join(""));
}

export function readSlips() {
  try { return readFileSync(slipsFile(), "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { return []; }
}

/** "undo" puts the day back, so the slips that change wrote go too. */
export function removeSlips(txn) {
  if (!txn) return;
  const kept = readSlips().filter((r) => r.txn !== txn);
  const file = slipsFile();
  try { writeFileSync(`${file}.tmp`, kept.map((r) => `${JSON.stringify(r)}\n`).join("")); renameSync(`${file}.tmp`, file); } catch { /* nothing logged yet */ }
}

/** Tells awareness the day changed (WP1 refreshes on it). */
export function touchDirty() {
  // A test bridge or an evaluation sandbox with no controlled dir of its own must not touch his real state.
  if (!process.env.ORION_CONTROLLED_DIR && (process.env.ORION_BRIDGE_BIN || sandbox())) return;   // also a schedule evaluation
  try {
    const file = join(controlledDir(), "awareness.dirty");
    mkdirSync(dirname(file), { recursive: true });
    closeSync(openSync(file, "a"));
    const now = new Date(); utimesSync(file, now, now);
  } catch { /* best effort */ }
}
