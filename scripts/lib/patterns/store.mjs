// learned-routines.json (written only by `orion-patterns learn`) and routine-answers.jsonl (his yes/no about a routine
// night: an answer to the evening ask, or something he said on his own). Coarse cells only; never a raw coordinate.
import { appendFileSync, mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readJson, writeJsonAtomic } from "../awareness/io.mjs";
import { eveningOf } from "./time.mjs";
import { parseStatement, verdictOf } from "./statements.mjs";

export const FILE = "learned-routines.json";
export const ANSWERS = "routine-answers.jsonl";
export const SCHEMA = "orion.learned-routines.v1";

export function readRoutines(dir) {
  const f = readJson(join(dir, FILE));
  return f?.schema === SCHEMA && Array.isArray(f.routines) ? f : { schema: SCHEMA, at: null, routines: [] };
}

export function writeRoutines(dir, { routines, at, sources }) {
  writeJsonAtomic(dir, FILE, { schema: SCHEMA, at, sources, routines });
}

export function readAnswers(dir) {
  try {
    return readFileSync(join(dir, ANSWERS), "utf8").split("\n").flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });
  } catch { return []; }
}

function append(dir, row) {
  mkdirSync(dir, { recursive: true });
  appendFileSync(join(dir, ANSWERS), `${JSON.stringify(row)}\n`);
}

/** His reply to the routine ask: confirms or refutes that evening. Returns the row written, or null when it says neither. */
export function recordAnswer(dir, { ask, text, now = new Date() }) {
  const verdict = verdictOf(text);
  if (!verdict) return null;
  const row = { at: now.toISOString(), evening: ask?.window?.date ?? eveningOf(now), routineId: ask?.routineId ?? null, verdict, source: "ask" };
  append(dir, row);
  return row;
}

/** Anything he says about going out tonight, or staying in, is evidence too (no ask needed). */
export function noteStatement(dir, { text, now = new Date() }) {
  const s = parseStatement(text);
  const minute = now.getHours() * 60 + now.getMinutes();
  if (!s || s.tense === "past" || !(minute >= 16 * 60 || minute < 5 * 60 || /\btonight\b/i.test(text))) return null;
  const row = { at: now.toISOString(), evening: eveningOf(now), routineId: null, verdict: s.polarity > 0 ? "confirm" : "refute", label: s.label, source: "said" };
  append(dir, row);
  return row;
}

/** Answers as learner statements ({ date, polarity, label, source }). */
export const answersAsStatements = (rows) => rows.filter((r) => r?.evening && ["confirm", "refute"].includes(r.verdict))
  .map((r) => ({ date: r.evening, at: r.at, polarity: r.verdict === "confirm" ? 1 : -1, label: r.label ?? null, source: r.source === "ask" ? "ask" : "said" }));
