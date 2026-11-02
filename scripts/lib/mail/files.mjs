// Where the mail watcher keeps its state (wave 14, 2026-11-02). All in the controlled dir (ORION_CONTROLLED_DIR), and during a
// sandboxed evaluation in eval-* twins, so a gate run never marks his real mail seen or learns a rule from a scripted reply.
//
//   mail-seen.jsonl    one row per message ORION has looked at: { key, threadId, messageId, at, level }. Append-only, tail-read.
//   mail-prefs.json    what Nick taught it: { rules: [{ id, action: mute|boost, kind: sender|domain|topic, value, added, via }] }.
//   mail-state.json    the poller's own clock: lastPollAt, expiredAlertedOn, lastAlertAt, queued alert items.
//   mail-alerts.jsonl  every alert sent, with the senders and subjects it named, so "not important" can be read against it.
import { appendFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "../awareness/io.mjs";

const NAMES = Object.freeze({ seen: "mail-seen.jsonl", prefs: "mail-prefs.json", state: "mail-state.json", alerts: "mail-alerts.jsonl" });
/** How many seen rows are kept in view: far more than two days of inbox. */
const SEEN_TAIL = 2000;

/** The file for `which` in `dir`; the eval- twin while a sandboxed evaluation runs. */
export const mailFile = (dir, which, { sandboxed = false } = {}) => join(dir, `${sandboxed ? "eval-" : ""}${NAMES[which]}`);

const jsonLines = (path) => {
  let text;
  try { text = readFileSync(path, "utf8"); } catch { return null; }
  return text.split("\n").flatMap((line) => { try { return line.trim() ? [JSON.parse(line)] : []; } catch { return []; } });
};

/** The seen keys, or null when the file does not exist yet (the first run only learns what is already there). */
export function readSeen(path) {
  const rows = jsonLines(path);
  return rows === null ? null : new Set(rows.slice(-SEEN_TAIL).map((r) => r?.key).filter(Boolean));
}

/** Appends rows. With no rows the file is still created, so "seen nothing yet" is recorded as seen. */
export function appendLines(path, rows) {
  mkdirSync(join(path, ".."), { recursive: true });
  appendFileSync(path, rows.length ? rows.map((r) => JSON.stringify(r)).join("\n") + "\n" : "");
}

export const readState = (path) => readJson(path) ?? {};
export const writeState = (path, value) => writeJsonAtomic(join(path, ".."), path.split("/").at(-1), value);

/** The newest alert rows, newest last. */
export const readAlerts = (path, max = 20) => (jsonLines(path) ?? []).slice(-max);
