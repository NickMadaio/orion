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
