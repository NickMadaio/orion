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

const GYM_WORDS = /\b(?:went to the gym|did (?:the )?gym|gym (?:done|is done)|done (?:with )?(?:the )?gym|worked out|did my workout|just lifted)\b/i;
const localMinute = (d) => d.getHours() * 60 + d.getMinutes();

/**
 * Did the gym happen today (2026-10-30: gym was 0 of 6 in patterns, and nothing could tell)? Evidence only, first found wins:
 *   a workout on health-log.json `workouts[]` for today: { day: "YYYY-MM-DD", startedAt: ISO, title?, source?: "whoop"|"healthkit"|... }
 *   (the WHOOP and HealthKit adapters write there; a workout he logs in the app has no source and counts as "workout-log"),
 *   awareness saying he is at the place "gym", a declared fact (place gym, or a note in his words: "went to the gym").
 * Any workout today counts: the goal is 90 minutes a day, not the planned slot.
 * @returns {{ source, at: ISO|null, minute: number|null } | null}
 */
export function gymEvidence({ date, workouts = [], placeId = null, declared = [], now = new Date() } = {}) {
  const today = (workouts ?? []).filter((w) => w && (w.day === date || (w.startedAt && new Date(w.startedAt).toLocaleDateString("en-CA") === date)))
    .filter((w) => !w.startedAt || Date.parse(w.startedAt) <= now.getTime())
    .sort((a, b) => String(a.startedAt).localeCompare(String(b.startedAt)));
  if (today.length) {
    const at = Date.parse(today[0].startedAt);
    return { source: today[0].source ?? "workout-log", at: Number.isFinite(at) ? new Date(at).toISOString() : null, minute: Number.isFinite(at) ? localMinute(new Date(at)) : null };
  }
  if (placeId === "gym") return { source: "place", at: now.toISOString(), minute: localMinute(now) };
  const said = (declared ?? []).find((f) => f && (!f.date || f.date === date)
    && ((f.kind === "place" && f.place === "gym") || (f.kind === "note" && GYM_WORDS.test(String(f.text)))));
  if (!said) return null;
  const at = Date.parse(said.at);
  return { source: "declared", at: Number.isFinite(at) ? said.at : null, minute: Number.isFinite(at) ? localMinute(new Date(at)) : null };
}
