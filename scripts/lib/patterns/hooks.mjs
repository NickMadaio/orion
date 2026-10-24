// The small entry points other modules call. Each is a one-liner at its call site, so a merge with code that owns those
// files (the gate, the proactive tick, the bedtime lines) stays trivial. Nothing here throws into its caller.
import { readRoutines, readAnswers, recordAnswer, noteStatement } from "./store.mjs";
import { routineNow, routineWindowsFor, NONE } from "./now.mjs";
import { ASK_TYPE } from "./ask.mjs";

/** awareness: the expected routine now (state, phase, holds), from learned-routines.json and his answers. */
export function routineFacet({ dir, now = new Date(), location = null }) {
  try { return routineNow(readRoutines(dir).routines, { now, answers: readAnswers(dir), location }); }
  catch { return { ...NONE }; }
}

/** gate: a non-urgent bedtime-type reminder during (or just before) his usual night out, or a nag/question while he is out. */
export function routineHold(aw, { kind = null } = {}) {
  const r = aw?.routine;
  if (!r || r.state !== "expected") return null;
  if (kind === "reminder" && r.holdsBedtime) return `his usual ${r.weekdayName} (${r.label}) - no bedtime nag`;
  if (["question", "checkin"].includes(kind) && r.holdsAsks) return `his usual ${r.weekdayName} (${r.label}) - not pestered while out`;
  return null;
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
