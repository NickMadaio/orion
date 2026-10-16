// curiosity.json (contract C7): every ask ORION made, whether it was answered, and the blank backoff (spec 3.4.3).
// Backoff applies to blank asks only: 60 min apart, doubling for each ignored one (60, 120, 240), reset by any answer.
// Mismatch nudges never consult it. Pure functions over a ledger value, plus read/write with tmp+rename.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { writeJsonAtomic, updateJson } from "../awareness/io.mjs";

export const FILE = "curiosity.json";
const MIN = 60_000;
export const BASE_GAP = 60, MAX_GAP = 240, IGNORED_AFTER = 45;
/** Asks that count toward spacing and the ignored streak (a save-place question is its own thing). */
const SPACED = ["home-gap", "away-gap", "unknown-place", "fill-blank"];
const BACKOFF = new Set(["home-gap", "away-gap", "unknown-place", "fill-blank"]);
export const OUTCOMES = ["answered", "logged", "nothing", "declined", "saved"];

export const emptyLedger = () => ({ asks: [], blankGapMinutes: BASE_GAP, pausedUntil: null });

export function readLedger(dir) {
  try {
    const l = JSON.parse(readFileSync(join(dir, FILE), "utf8"));
    return { ...emptyLedger(), ...l, asks: Array.isArray(l.asks) ? l.asks : [] };
  } catch { return emptyLedger(); }
}

/** Whole-file write, locked and atomic (the same lock `orion-awareness curiosity pause` takes). Prefer updateLedger to merge. */
export function writeLedger(dir, ledger) {
  writeJsonAtomic(dir, FILE, ledger);
}

/** Read-modify-write under the lock: `change(ledger)` sees the file as it is NOW, so a concurrent pause, close or ask is merged, not overwritten. */
export function updateLedger(dir, change) {
  updateJson(dir, FILE, (raw) => {
    const current = { ...emptyLedger(), ...raw, asks: Array.isArray(raw?.asks) ? raw.asks : [] };
    return change(current);
  });
}

/** Asks kept for 14 days: enough for "third day at this cell". */
export function recordAsk(ledger, ask) {
  const at = ask.at ?? new Date().toISOString();
  const keep = ledger.asks.filter((a) => Date.parse(at) - Date.parse(a.at) < 14 * 86400_000);
  return { ...ledger, asks: [...keep, { answeredAt: null, outcome: null, reachId: null, window: null, cell: null, ...ask, at }] };
}

/** Close an ask by id with an outcome ("nothing" logs nothing and marks the blank answered; "declined" is not ignored).
 *  A plain "answered" (a reply arrived) may be made more exact later ("logged", "nothing", ...), never the other way. */
export function closeAsk(ledger, askId, outcome, at = new Date().toISOString()) {
  if (!OUTCOMES.includes(outcome)) throw new Error(`outcome must be one of ${OUTCOMES.join(", ")}`);
  return { ...ledger, asks: ledger.asks.map((a) => (a.askId === askId && (!a.answeredAt || (a.outcome === "answered" && outcome !== "answered")) ? { ...a, answeredAt: a.answeredAt ?? at, outcome } : a)) };
}

/** Close asks from evidence: a logged block (tag `logged`) overlapping an open ask's window answers it as "logged". */
export function markAnswered(ledger, { logged = [], date, now = Date.now() } = {}) {
  const at = new Date(now).toISOString();
  return { ...ledger, asks: ledger.asks.map((a) => {
    if (a.answeredAt || !a.window || a.window.date !== date) return a;
    const hit = logged.some((b) => b.start < (a.window.end ?? 24 * 60) && b.end > a.window.start);
    return hit ? { ...a, answeredAt: at, outcome: "logged" } : a;
  }) };
}

/** Ignored: an open blank ask older than 45 min with no inbound turn in the 45 min after it. */
export function isIgnored(ask, { turns = [], now = Date.now() } = {}) {
  if (!BACKOFF.has(ask.type) || ask.answeredAt || ask.outcome) return false;
  const at = Date.parse(ask.at);
  if (now - at < IGNORED_AFTER * MIN) return false;
  return !turns.some((t) => t > at && t <= at + IGNORED_AFTER * MIN);
}

/** Current gap between blank asks: 60 doubled once per ignored ask in the trailing streak, at most 240. */
export function blankGap(ledger, { turns = [], now = Date.now() } = {}) {
  const blanks = ledger.asks.filter((a) => BACKOFF.has(a.type)).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  let ignored = 0;
  for (const a of blanks) {
    if (a.answeredAt || a.outcome) break;           // an answer (or a "not now") ends the streak: reset
    if (isIgnored(a, { turns, now })) ignored += 1;
  }
  return Math.min(MAX_GAP, BASE_GAP * 2 ** ignored);
}

/** May a new blank ask go out now? Not while paused, and not within the current gap of the last one. */
export function blankAllowed(ledger, { turns = [], now = Date.now() } = {}) {
  if (ledger.pausedUntil && Date.parse(ledger.pausedUntil) > now) return false;
  const last = ledger.asks.filter((a) => SPACED.includes(a.type)).map((a) => Date.parse(a.at)).sort((a, b) => b - a)[0];
  return last === undefined || now - last >= blankGap(ledger, { turns, now }) * MIN;
}

export const hasAsked = (ledger, key) => ledger.asks.some((a) => a.key === key);
/** Distinct local dates on which a given cell was asked about (the "third day at this cell" rule). */
export const daysAtCell = (ledger, cell) => new Set(ledger.asks.filter((a) => a.cell === cell).map((a) => String(a.at).slice(0, 10))).size;
