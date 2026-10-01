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
import { toMinute } from "./config.mjs";

const dayAfter = (date) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + 1); return d.toLocaleDateString("en-CA"); };

/** Minutes after `date`'s midnight when he wakes that morning. */
export function wakeOn(date, { blocksOf, config, wakeRequest = null }) {
  // Only a morning alarm is his wake-up. "Wake me at 3:30" after a lunchtime nap
  // drew the wake line at 3:30 PM (2026-09-30); the phone already ignored it.
  if (wakeRequest && wakeRequest.date === date && wakeRequest.minute < 12 * 60) return wakeRequest.minute;
  const usual = toMinute(config.usualWake);
  const first = blocksOf(date).filter((b) => b.fixed && b.source !== "orion").sort((a, b) => a.start - b.start)[0];
  return first ? Math.min(usual, first.start - (config.readyMinutes ?? 105)) : usual;
}

/** Minutes after `date`'s midnight by which he should be asleep that night (may pass 1440). */
export function bedOn(date, { blocksOf, config, wakeRequest = null }) {
  const bedtime = toMinute(config.bedtime);
  const target = bedtime < 12 * 60 ? 1440 + bedtime : bedtime;
  const needed = 1440 + wakeOn(dayAfter(date), { blocksOf, config, wakeRequest }) - Math.round((config.sleepHours ?? 8) * 60);
  let bed = Math.min(target, needed);
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
    const at = new Date(JSON.parse(readFileSync(join(homedir(), ".openclaw/orion-controlled/wake-request.json"), "utf8")).at);
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
