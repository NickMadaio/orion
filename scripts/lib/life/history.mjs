// Planned vs actual, kept so ORION can learn Nick's real patterns (2026-09-29).
// Every check-in that ends leaves one line: when he meant to start something,
// when he actually did (or that he didn't). Sleep and wake come from the
// health log. `summarize` turns it into patterns.json, which the planner and
// the check-ins read — each only once there are enough samples to mean anything.
import { appendFileSync, readFileSync, writeFileSync, renameSync, mkdirSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { learnPatterns } from "./patterns.mjs";
import { classify } from "./live-day.mjs";

const DIR = join(homedir(), ".openclaw/orion-controlled");
export const HISTORY_FILE = process.env.ORION_LIFE_HISTORY || join(DIR, "life-history.jsonl");
export const PATTERNS_FILE = process.env.ORION_PATTERNS_FILE || join(DIR, "patterns.json");
const minuteOf = (ms) => { const d = new Date(ms); return d.getHours() * 60 + d.getMinutes(); };

export function recordOutcome({ what, plannedAt, actualAt }) {
  const line = { at: new Date().toISOString(), what, kind: classify(what), plannedStart: minuteOf(plannedAt),
                 actualStart: actualAt === null ? null : minuteOf(actualAt), weekday: new Date(plannedAt).getDay() };
  mkdirSync(dirname(HISTORY_FILE), { recursive: true });
  appendFileSync(HISTORY_FILE, `${JSON.stringify(line)}\n`);
}

export function summarize(healthLog = {}) {
  let lines = [];
  try { lines = readFileSync(HISTORY_FILE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); } catch { lines = []; }
  const sleep = (healthLog.sleepLog ?? []).map((e) => ({ kind: e.event === "bed" ? "sleep" : "wake", minute: minuteOf(Date.parse(e.at)) }));
  const p = learnPatterns([...lines.slice(-500), ...sleep]);
  const out = { updatedAt: new Date().toISOString(), samples: lines.length, ...p };
  mkdirSync(dirname(PATTERNS_FILE), { recursive: true });
  writeFileSync(`${PATTERNS_FILE}.tmp`, JSON.stringify(out, null, 2)); renameSync(`${PATTERNS_FILE}.tmp`, PATTERNS_FILE);
  return out;
}

export function loadPatterns() {
  try { return JSON.parse(readFileSync(PATTERNS_FILE, "utf8")); } catch { return null; }
}

/** A sentence about a kind, only when three or more samples say the same thing. */
export function lateHabit(patterns, kind) {
  const k = patterns?.byKind?.[kind];
  if (!k || k.happened < 3 || k.medianDelay === null || k.medianDelay < 15) return null;
  return `You usually start these about ${Math.round(k.medianDelay / 5) * 5} min late — not today.`;
}
