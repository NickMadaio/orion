// His sleep plan worked out for the coming week (W10-B, 2026-11-02), shared by scripts/orion-sleepplan and its tests.
//
// wake-plan.json (in the controlled dir; eval-wake-plan.json during a sandboxed evaluation) is read by the Mac alarm and
// bedtime-nudge engine. Its shape is a contract, keep it:
//   {
//     source: "nick" | "default",   // "nick" only once he set a per-day wake or a class lead (orion-sleepplan / the chat
//                                   // interview). Alarms ring ONLY for "nick": a "default" file (e.g. written by an exception
//                                   // alone) must never start a 09:00 alarm he did not ask for.
//     generatedAt: ISO,
//     alarms:    [{ date: "YYYY-MM-DD", at: "HH:MM", iso: ISO, reason, byNick: true }],   // only mornings he asked for (plan/class)
//     bedtimes:  [{ date: "YYYY-MM-DD", sleepBy: "HH:MM", nudgeAt: "HH:MM", sleepByIso: ISO, nudgeAtIso: ISO }],
//     lockdowns: [{ date: "YYYY-MM-DD", at: "HH:MM", iso: ISO, exception: { reason, until } | null }],
//     sleepHours: number, nudgeBeforeMin: number, lockdownBelowHours: number
//   }
// alarms[].reason: "plan" (his per-day wake) or "class" (first class − lead) only; byNick is always true and readers require it.
// Computed wakes (usual, commitment) and one-off requests are never alarms here.
// bedtimes[].date and lockdowns[].date are the EVENING the night begins on; their HH:MM may be after midnight (the
// *Iso fields are exact). Each bedtime is the night before that morning (bedtimes cover every coming morning, alarms only the asked ones). lockdowns[].at is the
// moment projected sleep before that alarm drops to lockdownBelowHours: past it ORION shuts him down, unless that
// evening carries an exception (a legit reason he gave: friends, a party, a bar, schoolwork; never gaming or idling).
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { sleepPlanOf, toMinute, WEEKDAYS } from "./config.mjs";
import { bedOn, firstClassOn, wakeWhy, weekdayOf } from "./night.mjs";

const pad = (n) => String(n).padStart(2, "0");
export const hhmm = (minute) => { const m = ((minute % 1440) + 1440) % 1440; return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`; };
export const addDays = (date, n) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + n); return d.toLocaleDateString("en-CA"); };
/** The local instant `minute` minutes after `date`'s midnight (may pass 1440). */
export const instant = (date, minute) => { const [y, mo, d] = date.split("-").map(Number); return new Date(y, mo - 1, d, 0, minute, 0, 0); };
/** The evening a moment belongs to: the day turns at 4 AM. */
export const eveningOf = (now) => new Date(now.getTime() - 4 * 3600_000).toLocaleDateString("en-CA");

/** Day names in: "mon,wed,thu", "weekdays", "weekends", "all", "gym" (the given gym days). Throws on anything else. */
export function parseDays(raw, gym = []) {
  const words = String(raw ?? "").toLowerCase().split(/[\s,]+/).filter(Boolean);
  const out = new Set();
  for (const w of words) {
    if (w === "all" || w === "everyday") WEEKDAYS.forEach((d) => out.add(d));
    else if (w === "weekdays") ["mon", "tue", "wed", "thu", "fri"].forEach((d) => out.add(d));
    else if (w === "weekends") ["sat", "sun"].forEach((d) => out.add(d));
    else if (w === "gym") gym.forEach((d) => out.add(d));
    else if (WEEKDAYS.includes(w.slice(0, 3))) out.add(w.slice(0, 3));
    else throw new TypeError(`"${w}" is not a day`);
  }
  if (!out.size) throw new TypeError("no days given");
  return WEEKDAYS.filter((d) => out.has(d));
}

/** A new plan with wake set on `days` (only: every other day's wake removed). Pure. */
export function withWake(plan, days, wake, { only = false } = {}) {
  const kept = only ? {} : { ...plan.byDay };
  const byDay = { ...kept, ...Object.fromEntries(days.map((d) => [d, { wake }])) };
  return { ...plan, byDay };
}

/** The 7 coming mornings and the night before each, from `now`. */
export function weekPlan({ now, config, blocksOf, wakeRequest = null }) {
  const plan = sleepPlanOf(config);
  const today = now.toLocaleDateString("en-CA");
  const mornings = [];
  for (let i = 0; i <= 8 && mornings.length < 7; i += 1) {
    const date = addDays(today, i);
    const why = wakeWhy(date, { blocksOf, config, wakeRequest });
    if (instant(date, why.minute) > now) mornings.push({ date, ...why });
  }
  return mornings.map(({ date, minute, reason }) => {
    const evening = addDays(date, -1);
    const bed = bedOn(evening, { blocksOf, config, wakeRequest });
    const nudge = bed - plan.nudgeBeforeMin;
    const lock = 1440 + minute - Math.round(plan.lockdownBelowHours * 60);
    const cls = firstClassOn(date, blocksOf);
    const exception = plan.exceptions.find((e) => e.date === evening) ?? null;
    return { date, weekday: weekdayOf(date), wake: hhmm(minute), wakeIso: instant(date, minute).toISOString(), reason,
      firstClass: cls ? { title: cls.title, at: hhmm(cls.start) } : null,
      evening, sleepBy: hhmm(bed), sleepByIso: instant(evening, bed).toISOString(), nudgeAt: hhmm(nudge), nudgeAtIso: instant(evening, nudge).toISOString(),
      lockdownAt: hhmm(lock), lockdownIso: instant(evening, lock).toISOString(),
      exception: exception ? { reason: exception.reason, until: exception.until ?? null } : null };
  });
}

const ASKED_REASONS = new Set(["plan", "class"]);

/** The wake-plan.json document (shape in the header). */
export function wakePlanDoc({ now, days, config }) {
  const plan = sleepPlanOf(config);
  const byNick = Object.keys(plan.byDay).length > 0 || Number.isInteger(plan.firstClassLeadMin)
    || Object.values(plan.overrides ?? {}).some((t) => t !== "off");
  return {
    source: byNick ? "nick" : "default",
    generatedAt: now.toISOString(),
    // Only alarms he asked for ring: his per-day wake ("plan") and his class-lead rule ("class"). usual/commitment/asked are
    // never emitted (a one-off request lives in wake-request.json, read by both devices on its own).
    alarms: days.filter((d) => ASKED_REASONS.has(d.reason)).map((d) => ({ date: d.date, at: d.wake, iso: d.wakeIso, reason: d.reason, byNick: true })),
    bedtimes: days.map((d) => ({ date: d.evening, sleepBy: d.sleepBy, nudgeAt: d.nudgeAt, sleepByIso: d.sleepByIso, nudgeAtIso: d.nudgeAtIso })),
    lockdowns: days.map((d) => ({ date: d.evening, at: d.lockdownAt, iso: d.lockdownIso, exception: d.exception })),
    sleepHours: plan.sleepHours, nudgeBeforeMin: plan.nudgeBeforeMin, lockdownBelowHours: plan.lockdownBelowHours,
  };
}

export function writeWakePlan(dir, name, doc) {
  mkdirSync(dir, { recursive: true });
  const file = join(dir, name);
  writeFileSync(`${file}.tmp`, JSON.stringify(doc, null, 2));
  renameSync(`${file}.tmp`, file);
  return file;
}

/** Exceptions from before yesterday evening are gone; one per evening (the newest wins). Pure. */
export function withException(plan, exception, now) {
  const floor = addDays(eveningOf(now), -1);
  const kept = plan.exceptions.filter((e) => e.date >= floor && e.date !== exception.date);
  return { ...plan, exceptions: [...kept, exception] };
}

export const minuteOf = toMinute;

/** A new plan with one morning's alarm set to `time` (HH:MM) or "off". Pure. */
export const withOverride = (plan, date, time) => ({ ...plan, overrides: { ...(plan.overrides ?? {}), [date]: time } });

/** Overrides for mornings already behind `today` are gone. Pure. */
export const pruneOverrides = (plan, today) => ({ ...plan, overrides: Object.fromEntries(Object.entries(plan.overrides ?? {}).filter(([d]) => d >= today)) });

/** The date a day word names, counting from `now`: today, tomorrow, a weekday (the next one whose alarm is still ahead), or YYYY-MM-DD. */
export function wakeDate(raw, now, minute = null) {
  const today = now.toLocaleDateString("en-CA");
  const w = String(raw ?? "").toLowerCase().trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(w)) return w;
  if (w === "today") return today;
  if (w === "tomorrow" || w === "tmrw") return addDays(today, 1);
  if (!WEEKDAYS.includes(w.slice(0, 3)) || w.length < 3) return null;
  for (let i = 0; i <= 7; i += 1) {
    const date = addDays(today, i);
    if (weekdayOf(date) === w.slice(0, 3) && (i > 0 || minute === null || instant(date, minute) > now)) return date;
  }
  return null;
}
