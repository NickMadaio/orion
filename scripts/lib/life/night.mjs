// When he wakes and when he should be asleep, per day (2026-09-30). Nick: "make
// little markers for when i wake up (orion alarm) and when i should be asleep by
// (wind down is prior to that and ends at the 'asleep' line)".
// The same rule the phone's NightPlan uses to set the real alarm, so the Mac's
// markers and the planner's wind-down agree with it:
//   wake  = the time he asked for ("wake me at 7:30") if it falls that morning,
//           else min(usual wake, first real commitment − get-ready time);
//   bed   = min(bedtime, next wake − sleep need), or after a plan that runs
//           through it (a night out) plus the trip home.
// "Real commitment" excludes ORION's own blocks: a side-project hour it planned
// at 8 must not drag the alarm to 6:45.
// W10-B (2026-11-02): his sleep plan (config.sleepPlan, scripts/orion-sleepplan) adds two things:
//   - a wake time per weekday ("6am for the gym, only mon wed thu"), and
//   - a lead before his first class ("at least 3 hours before a class"): the wake is never later than that.
//   wake = asked-for alarm, else byDay wake, else min(usual wake, first class − lead); always capped by
//          first class − lead (when a lead is set) and first commitment − get-ready time.
//   bed  = next wake − sleep need (capped by bedtime), unless a night out runs through it.
import { toMinute, sleepPlanOf, WEEKDAYS } from "./config.mjs";
import { classify } from "./live-day.mjs";
import { napCreditMinutes } from "./naps.mjs";

const dayAfter = (date) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + 1); return d.toLocaleDateString("en-CA"); };
/** "mon".."sun" for a YYYY-MM-DD. */
export const weekdayOf = (date) => WEEKDAYS[new Date(`${date}T12:00:00`).getDay()];
const real = (blocks) => blocks.filter((b) => b.fixed && b.source !== "orion").sort((a, b) => a.start - b.start);
/** His first real class that day, or undefined. */
export const firstClassOn = (date, blocksOf) => real(blocksOf(date)).find((b) => (b.kind ?? classify(b.title ?? "")) === "class");

/** Why the wake is what it is: { minute, reason } (reason: "asked" | "plan" | "class" | "commitment" | "usual"). */
export function wakeWhy(date, { blocksOf, config, wakeRequest = null }) {
  // Only a morning alarm is his wake-up. "Wake me at 3:30" after a lunchtime nap
  // drew the wake line at 3:30 PM (2026-09-30); the phone already ignored it.
  if (wakeRequest && wakeRequest.date === date && wakeRequest.minute < 12 * 60) return { minute: wakeRequest.minute, reason: "asked" };
  const plan = sleepPlanOf(config);
  // One morning said outright ("wake me at 6:45 tomorrow") is honoured exactly; "off" is no alarm that morning.
  const override = plan.overrides?.[date];
  if (override && override !== "off") return { minute: toMinute(override), reason: "plan" };
  const planned = override === "off" ? undefined : plan.byDay[weekdayOf(date)]?.wake;
  let best = planned ? { minute: toMinute(planned), reason: "plan" } : { minute: toMinute(config.usualWake), reason: "usual" };
  const lead = Number.isInteger(plan.firstClassLeadMin) && override !== "off" ? plan.firstClassLeadMin : null;
  const cls = lead !== null ? firstClassOn(date, blocksOf) : undefined;
  if (cls && cls.start - lead < best.minute) best = { minute: cls.start - lead, reason: "class" };
  const first = real(blocksOf(date))[0];
  const ready = config.readyMinutes ?? 105;
  if (first && first.start - ready < best.minute) best = { minute: first.start - ready, reason: "commitment" };
  return { minute: Math.max(0, best.minute), reason: best.reason };
}

/** Minutes after `date`'s midnight when he wakes that morning. */
export function wakeOn(date, options) {
  return wakeWhy(date, options).minute;
}

/**
 * Minutes after `date`'s midnight by which he should be asleep that night (may pass 1440).
 * `napMinutes`: what he already slept in naps that day (WHOOP). A real nap takes up to an hour off tonight's need and lets
 * the bedtime slide by the same amount, never earlier (W20).
 * w20 routegate: a bedtime he named for this night is exact (no sleep-need cap, no nap credit, no night-out push); a standing one
 * he named (plan.bedFixed) is exact too. The shortfall is said, never silently capped.
 */
export function bedOn(date, { blocksOf, config, wakeRequest = null, napMinutes = 0 }) {
  const plan = sleepPlanOf(config);
  const forced = plan.bedOverrides?.[date];
  if (forced) { const f = toMinute(forced); return f < 12 * 60 ? 1440 + f : f; }
  const credit = napCreditMinutes(napMinutes);
  const bedtime = toMinute(config.bedtime);
  const target = (bedtime < 12 * 60 ? 1440 + bedtime : bedtime) + credit;
  const needed = 1440 + wakeOn(dayAfter(date), { blocksOf, config, wakeRequest }) - Math.round(plan.sleepHours * 60) + credit;
  let bed = plan.bedFixed ? target : Math.min(target, needed);
  const lateFixed = blocksOf(date).filter((b) => b.fixed && b.source !== "orion" && b.end > bed).sort((a, b) => b.end - a.end)[0];
  if (lateFixed) bed = lateFixed.end + (config.commuteMinutes ?? 30);
  return bed;
}

/** Both markers for one day: { date, wake, bed } in minutes after that day's midnight. */
export function nightMarkers(date, options) {
  return { date, wake: wakeOn(date, options), bed: bedOn(date, options) };
}

/** The wake-up he asked ORION for (orion-wake), as { date, minute }, or null. */
export async function readWakeRequest() {
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { homedir } = await import("node:os");
  try {
    const at = new Date(JSON.parse(readFileSync(join((await import("../clock.mjs")).controlledDir(), "wake-request.json"), "utf8")).at);
    return Number.isNaN(at.getTime()) ? null : { date: at.toLocaleDateString("en-CA"), minute: at.getHours() * 60 + at.getMinutes() };
  } catch { return null; }
}

/*
 When he actually woke and fell asleep (2026-10-01: "have the wake up line move
 to when I actually wake up"). Most trusted first:
   1. WHOOP's sleep record (sleep-actual.json, written by the ORION app),
   2. the phone's "up" (he stopped the alarm or said he's up),
   3. the first sign of the phone in use after 4 AM: unplugged, or moving.
 Times are local minutes after `date`'s midnight; null when nothing says so.
*/
const local = (iso) => { const d = new Date(iso); return { date: d.toLocaleDateString("en-CA"), minute: d.getHours() * 60 + d.getMinutes() }; };

/** @returns { minute, source } | null — when he got up on `date` */
export function actualWake(date, { nights = [], sleepLog = [], phoneSignals = [], now = null } = {}) {
  const before = (iso) => !now || new Date(iso) <= now;
  const morning = (iso) => { const t = local(iso); return t.date === date && t.minute >= 180 && t.minute < 14 * 60; };
  const whoop = nights.filter((n) => n.wokeAt && morning(n.wokeAt) && before(n.wokeAt))
    .sort((a, b) => (new Date(b.wokeAt) - new Date(b.fellAsleep)) - (new Date(a.wokeAt) - new Date(a.fellAsleep)))[0];
  if (whoop) return { minute: local(whoop.wokeAt).minute, source: "whoop" };
  const up = sleepLog.filter((e) => e.event === "up" && morning(e.at) && before(e.at)).sort((a, b) => a.at.localeCompare(b.at))[0];
  if (up) return { minute: local(up.at).minute, source: "phone" };
  const lastBed = sleepLog.filter((e) => e.event === "bed").map((e) => e.at).sort().at(-1) ?? "";
  const stirring = phoneSignals.filter((s) => s.at > lastBed && morning(s.at) && local(s.at).minute >= 240 && before(s.at)
    && (s.charging === false || ["walking", "running", "cycling", "vehicle"].includes(s.motion))).sort((a, b) => a.at.localeCompare(b.at))[0];
  if (stirring) return { minute: local(stirring.at).minute, source: "phone" };
  return null;
}

/** @returns { minute, source } | null — when he fell asleep the night that began on `date` (may pass 1440) */
export function actualSleep(date, { nights = [], sleepLog = [] } = {}) {
  const startOf = (iso) => { const t = local(iso); const next = new Date(`${date}T12:00:00`); next.setDate(next.getDate() + 1);
    if (t.date === date && t.minute >= 18 * 60) return t.minute;
    if (t.date === next.toLocaleDateString("en-CA") && t.minute < 12 * 60) return 1440 + t.minute;
    return null; };
  const whoop = nights.map((n) => ({ n, m: n.fellAsleep ? startOf(n.fellAsleep) : null })).filter((x) => x.m !== null)
    .sort((a, b) => (new Date(b.n.wokeAt) - new Date(b.n.fellAsleep)) - (new Date(a.n.wokeAt) - new Date(a.n.fellAsleep)))[0];
  if (whoop) return { minute: whoop.m, source: "whoop" };
  const bed = sleepLog.filter((e) => e.event === "bed").map((e) => startOf(e.at)).filter((m) => m !== null).sort((a, b) => b - a)[0];
  return bed !== undefined ? { minute: bed, source: "phone" } : null;
}
