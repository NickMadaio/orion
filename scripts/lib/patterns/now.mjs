// What the learned routines say about NOW (pure): "probably out" during a confident routine, the evening before it,
// and the morning after it. His answer for tonight wins over the pattern; fresh evidence of him at home ends the hold.
import { addDays, clock, eveningOf, minuteOf, nightMinute, weekdayOf } from "./time.mjs";

export const HOLD_BEFORE = 30, HOLD_AFTER = 30, ASK_LEAD = 240, BED_LEAD = 90, HOME_AFTER = 60, MORNING_GRACE = 60;
export const NONE = Object.freeze({ state: "none", holdsBedtime: false, holdsAsks: false });

const usable = (r) => r?.status === "confident" && Number.isFinite(r.start) && Number.isFinite(r.end);
/** His last word about that evening ("confirm" | "refute"), or null. */
export const verdictFor = (answers, date) => (answers ?? []).filter((a) => a.evening === date && ["confirm", "refute"].includes(a.verdict))
  .sort((a, b) => String(a.at).localeCompare(String(b.at))).at(-1)?.verdict ?? null;

const pick = (routines, date) => (routines ?? []).filter((r) => usable(r) && r.kind === "away-evening" && r.weekday === weekdayOf(date))
  .sort((a, b) => b.confidence - a.confidence)[0] ?? null;

const base = (r, date) => ({ routineId: r.id, label: r.label, weekdayName: r.weekdayName, date, start: r.start, end: r.end, confidence: r.confidence,
  window: { date, start: r.start - HOLD_BEFORE, end: r.end + HOLD_AFTER }, text: `${r.label} (usual ${r.weekdayName}, ${clock(r.start)}–${clock(r.end)})` });

/**
 * @param routines  learned-routines.json `routines`
 * @param answers   routine-answers.jsonl rows
 * @param location  the awareness location facet (fresh), or null
 * @param nightHappened (date, routine) => true when last night's routine really happened (away fixes in its window)
 * @returns { state: "expected"|"refuted"|"home-instead"|"morning-after"|"none", phase?, holdsBedtime, holdsAsks, ... }
 */
export function routineNow(routines, { now = new Date(), answers = [], location = null, nightHappened = () => null } = {}) {
  const date = eveningOf(now);
  const r = pick(routines, date);
  const m = nightMinute(now, date);
  if (r && m >= r.start - ASK_LEAD && m < r.end + HOLD_AFTER) {
    const phase = m < r.start - HOLD_BEFORE ? "before" : "in";
    const verdict = verdictFor(answers, date);
    const out = { ...base(r, date), phase, confirmed: verdict === "confirm" };
    if (verdict === "refute") return { ...out, state: "refuted", holdsBedtime: false, holdsAsks: false };
    if (phase === "in" && m >= r.start + HOME_AFTER && location?.state === "home") return { ...out, state: "home-instead", holdsBedtime: false, holdsAsks: false };
    return { ...out, state: "expected", holdsBedtime: phase === "in" || r.start - m <= BED_LEAD, holdsAsks: phase === "in" };
  }
  // the morning after a routine night: a later wake is expected, nothing scolds him for it
  const prev = addDays(now.toLocaleDateString("en-CA"), -1);
  const pr = pick(routines, prev);
  // only after a night that happened: he said yes, or the phone was away in its window (not a night he stayed in)
  if (pr && verdictFor(answers, prev) !== "refute" && (verdictFor(answers, prev) === "confirm" || nightHappened(prev, pr) === true)) {
    const wakeBy = (pr.nextWake ?? (Number.isFinite(pr.usualWake) ? pr.usualWake + 120 : 12 * 60)) + MORNING_GRACE;
    if (minuteOf(now) < wakeBy) return { ...base(pr, prev), state: "morning-after", phase: "after", wakeBy, holdsBedtime: false, holdsAsks: false };
  }
  return { ...NONE };
}

/**
 * The windows confident routines claim on a calendar date, as minutes of that date: tonight's routine, and the small hours
 * of last night's. Refuted evenings claim nothing. Used by the day review (known, not blank) and the scheduler (not booked).
 * @returns [{ start, end, label, routineId }]
 */
export function routineWindowsFor(routines, date, { answers = [], kinds = ["away-evening", "activity"] } = {}) {
  const out = [];
  for (const r of (routines ?? []).filter((x) => usable(x) && kinds.includes(x.kind))) {
    if (r.weekday === weekdayOf(date) && verdictFor(answers, date) !== "refute") out.push({ start: Math.max(0, r.start), end: Math.min(1440, r.end), label: r.label, routineId: r.id });
    const prev = addDays(date, -1);
    if (r.end > 1440 && r.weekday === weekdayOf(prev) && verdictFor(answers, prev) !== "refute") out.push({ start: 0, end: Math.min(1440, r.end - 1440), label: r.label, routineId: r.id });
  }
  return out.filter((w) => w.end > w.start);
}
