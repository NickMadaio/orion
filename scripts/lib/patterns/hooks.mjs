// The small entry points other modules call. Each is a one-liner at its call site, so a merge with code that owns those
// files (the gate, the proactive tick, the bedtime lines) stays trivial. Nothing here throws into its caller.
import { readRoutines, readAnswers, recordAnswer, noteStatement } from "./store.mjs";
import { routineNow, routineWindowsFor, NONE } from "./now.mjs";
import { ASK_TYPE } from "./ask.mjs";
import { join } from "node:path";
import { readJson } from "../awareness/io.mjs";
import { readKnownPlaces } from "../awareness/places.mjs";
import { fixesOf } from "./episodes.mjs";
import { homeTest } from "./sources.mjs";
import { nightMinute } from "./time.mjs";

/** Was he away from home in that night's routine window? Read only when a morning-after is in question. */
export const awayInWindow = (fixes, isHome) => (date, r) =>
  fixes.some((f) => { const m = nightMinute(f.at, date); return m >= r.start - 60 && m <= r.end + 60 && !isHome(f); });

const nightHappenedFrom = (dir) => (date, r) => {
  const fixes = fixesOf(readJson(join(dir, "health-log.json"))?.phoneSignals);
  return awayInWindow(fixes, homeTest(readKnownPlaces(dir), fixes))(date, r);
};

/** awareness: the expected routine now (state, phase, holds), from learned-routines.json and his answers. */
export function routineFacet({ dir, now = new Date(), location = null }) {
  try { return routineNow(readRoutines(dir).routines, { now, answers: readAnswers(dir), location, nightHappened: nightHappenedFrom(dir) }); }
  catch { return { ...NONE }; }
}

/** The bedtime family only (lib/reach/proactive.mjs: bed-wind, bed-now, bed-late). A leave reminder, a check-in or anything
 *  protected is never held by a routine. */
export const BEDTIME_WHY = /^proactive: bed-(?:wind|now|late)\b/;

/** gate: hold a bedtime nag during (or just before) his usual night out. Returns the reason, or null. */
export function routineHold(aw, { why = null, tier = null } = {}) {
  const r = aw?.routine;
  if (!r || r.state !== "expected" || !r.holdsBedtime || tier === "protected" || !BEDTIME_WHY.test(String(why ?? ""))) return null;
  return `his usual ${r.weekdayName} (${r.label}) - no bedtime nag`;
}

/** day review / scheduler: the windows confident routines claim on `date` ({ start, end, label }). */
export function routineWindows({ dir, date }) {
  try { return routineWindowsFor(readRoutines(dir).routines, date, { answers: readAnswers(dir) }); }
  catch { return []; }
}

/** scheduler: routine windows that nothing already sits in, as `blocked` walls (work is not booked into them). */
export function routineWalls({ dir, date, existing = [] }) {
  return routineWindows({ dir, date }).filter((w) => !existing.some((b) => b.start < w.end && b.end > w.start))
    .map((w) => ({ start: w.start, end: w.end, title: `usual ${w.label}` }));
}

/** orion-inbound-turn: his message as evidence (a reply to the routine ask, or "going out tonight" / "staying in"). */
export function noteInbound({ dir, ask = null, text, now = new Date() }) {
  try { return ask?.type === ASK_TYPE ? recordAnswer(dir, { ask, text, now }) : noteStatement(dir, { text, now }); }
  catch { return null; }
}
