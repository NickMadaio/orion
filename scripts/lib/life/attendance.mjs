// Did he actually go to a class? (2026-10-16 audit, finding 1.) On 2026-10-15 he slept
// through CS1800 (9:00; WHOOP says he woke at 9:29) and the afterClass line called it "done".
// Evidence only: never assume attendance. Minutes are local minutes after midnight.
const MOVING = new Set(["walking", "running", "cycling", "vehicle", "automotive"]);

/**
 * @param block  a class block { start, end }
 * @param wokeAt minute he actually got up today (WHOOP / phone), or null
 * @param phone  [{ minute, charging, motion }] today's phone samples
 * @returns "attended" | "missed" | "unknown"
 */
export function classAttendance(block, { wokeAt = null, phone = [] } = {}) {
  const near = phone.filter((s) => s.minute >= block.start - 45 && s.minute <= block.end);
  if (near.some((s) => s.charging === false && MOVING.has(s.motion))) return "attended";
  if (wokeAt != null && wokeAt >= block.start) return "missed";
  const atStart = phone.filter((s) => s.minute >= block.start && s.minute <= block.start + 30);
  if (atStart.length && atStart.every((s) => s.charging === true)) return "missed";
  return "unknown";
}

/** Phone samples as local minutes for `date`, from health-log phoneSignals. */
export function phoneMinutes(phoneSignals, date) {
  return (phoneSignals ?? []).flatMap((s) => {
    const d = new Date(s.at);
    return Number.isNaN(d.getTime()) || d.toLocaleDateString("en-CA") !== date ? [] : [{ minute: d.getHours() * 60 + d.getMinutes(), charging: s.charging, motion: s.motion }];
  });
}

/** The latest minute he was seen leaving (unplugged and moving) at or before `minute`, else null. */
export function leftAt(phone, minute, withinMinutes = 45) {
  const hits = phone.filter((s) => s.charging === false && MOVING.has(s.motion) && s.minute <= minute && minute - s.minute <= withinMinutes);
  return hits.length ? Math.max(...hits.map((s) => s.minute)) : null;
}
