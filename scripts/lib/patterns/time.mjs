// Time helpers for routine learning. A night belongs to the evening it started: until 08:00 it is still "yesterday".
// Times inside a routine are "night minutes": minutes since 00:00 of the anchor date, so 23:00 is 1380 and 03:00 the
// next morning is 1620. That keeps a Friday-night window one straight interval, with no wrap at midnight.
const DAY_MS = 86_400_000;
export const MORNING_CUTOFF = 8 * 60;
export const WEEKDAYS = Object.freeze(["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"]);

export const localDate = (d) => new Date(d).toLocaleDateString("en-CA");
export const minuteOf = (d) => { const t = new Date(d); return t.getHours() * 60 + t.getMinutes(); };

/** The evening a moment belongs to (before 08:00 it is the previous day's evening). */
export const eveningOf = (at) => {
  const t = new Date(at);
  return minuteOf(t) < MORNING_CUTOFF ? localDate(new Date(t.getTime() - 12 * 3600_000)) : localDate(t);
};

/** Local midnight of a YYYY-MM-DD date, in ms. */
export const midnightOf = (date) => new Date(`${date}T00:00:00`).getTime();

/** Minutes since midnight of `date` (may exceed 1440 for the small hours after it). DST-safe enough for medians. */
export const nightMinute = (at, date) => {
  const t = new Date(at);
  const days = Math.round((midnightOf(localDate(t)) - midnightOf(date)) / DAY_MS);
  return days * 1440 + minuteOf(t);
};

/** The ms instant of night minute `m` on `date`. */
export const atNightMinute = (date, m) => {
  const day = Math.floor(m / 1440);
  const base = new Date(`${date}T12:00:00`);
  base.setDate(base.getDate() + day);
  const d = localDate(base);
  return new Date(`${d}T00:00:00`).getTime() + (m - day * 1440) * 60_000;
};

export const addDays = (date, n) => { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + n); return localDate(d); };
export const weekdayOf = (date) => new Date(`${date}T12:00:00`).getDay();
export const daysBetween = (a, b) => Math.round((midnightOf(b) - midnightOf(a)) / DAY_MS);

export const median = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
};

/** "23:00" for a night minute (1620 is "03:00"). */
export const clock = (m) => {
  if (!Number.isFinite(m)) return "?";
  const x = ((Math.round(m) % 1440) + 1440) % 1440;
  return `${String(Math.floor(x / 60)).padStart(2, "0")}:${String(x % 60).padStart(2, "0")}`;
};
