// When the day review goes (2026-10-19): 22:00, or 60 minutes before bedtime when that is earlier, and never after midnight.
// It describes the day that is ending, so once the date has changed it is not sent: a missed review is not delivered the
// next morning (2026-10-18's went out at 00:01 describing the new day). Pure.
const toMinute = (t) => { const [h, m] = String(t ?? "").split(":").map(Number); return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : null; };
const FLOOR = 17 * 60;

/** Bedtime as minutes on the evening's own clock: a 00:30 bed is 1470, not 30. */
export const bedOnEvening = (bedtime) => { const b = toMinute(bedtime) ?? 23 * 60 + 45; return b < 12 * 60 ? b + 1440 : b; };

/** The minute the review becomes due this evening. */
export function reviewMinute({ bedtime, config = {} }) {
  const at = toMinute(config.reviewAt ?? "22:00") ?? 22 * 60;
  const before = Number(config.reviewBeforeBedMinutes ?? 60);
  return Math.max(FLOOR, Math.min(at, bedOnEvening(bedtime) - before, 1439));
}

/**
 * Is the review due now? `date` is the day the review is for; it is only due on that same calendar day, from the review
 * minute until midnight, so a late or missed one is never sent about a day that is over.
 */
export const reviewDue = ({ minute, date, today, bedtime, config }) => date === today && minute >= reviewMinute({ bedtime, config });
