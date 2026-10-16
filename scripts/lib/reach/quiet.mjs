// Quiet hours, derived from his sleep window (2026-10-16 audit, finding 4).
// Before this, presence.mjs waited for a sleep state "night" that sleep-state.mjs
// never produces, so nothing was ever held; a non-urgent push went out at 03:09.
// Pure: minutes after midnight in, a verdict out. The files are read by presence().
import { toMinute } from "../life/config.mjs";
import { actualWake } from "../life/night.mjs";

/** Only these may bypass quiet hours. Bedtime nags, check-ins and nudges never do. */
export const URGENT_KINDS = Object.freeze(["reminder", "class"]);

/** What may get through quiet hours (and a focus session): a reminder he set, or a class he is about to miss. */
export const bypassesQuiet = ({ urgentKind = null } = {}) => URGENT_KINDS.includes(urgentKind);

/** Whether the phone should show it as urgent (time-sensitive): the --urgent flag AND a genuine kind. A bare --urgent is not enough. */
export const isUrgentNotification = ({ urgent = false, urgentKind = null } = {}) => urgent === true && bypassesQuiet({ urgentKind });

/**
 * @param minute  now, minutes after midnight
 * @param bed     tonight's asleep-by (may pass 1440; at >= 1440 tonight's window opens after midnight)
 * @param wake    this morning's wake
 * @param lastBed last night's asleep-by (may pass 1440), so 00:10 is not quiet before a 00:30 bed
 * @param wokeAt  when he actually got up this morning, if known
 */
export function isQuietNow({ minute, bed, wake, lastBed = null, wokeAt = null }) {
  if (bed < 1440 && minute >= bed) return true;
  const opened = lastBed == null ? 0 : Math.max(0, lastBed - 1440);
  if (minute >= opened && minute < wake) return !(wokeAt != null && wokeAt <= minute);
  return false;
}

/**
 * His sleep window for `date`: the planner's night (night.json, written by orion-watch),
 * his actual wake (sleep-actual.json), else the life config's bedtime and usual wake.
 */
export function sleepWindowFor({ date, config, night = null, nights = [] }) {
  const days = night?.days ?? [];
  const today = days.find((d) => d?.date === date);
  const yesterday = days.find((d) => d?.date === dayBefore(date));
  const cfgBed = toMinute(config?.bedtime ?? "00:00");
  const bed = Number.isFinite(today?.bed) ? today.bed : cfgBed < 12 * 60 ? 1440 + cfgBed : cfgBed;
  const wake = Number.isFinite(today?.plannedWake) ? today.plannedWake : Number.isFinite(today?.wake) ? today.wake : toMinute(config?.usualWake ?? "09:00");
  const lastBed = Number.isFinite(yesterday?.bed) ? yesterday.bed : null;
  const actual = actualWake(date, { nights });
  const wokeAt = actual ? actual.minute : today?.woke && Number.isFinite(today.wake) ? today.wake : null;
  return { bed, wake, lastBed, wokeAt };
}

function dayBefore(date) { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() - 1); return d.toLocaleDateString("en-CA"); }
