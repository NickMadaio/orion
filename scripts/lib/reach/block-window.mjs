// A nudge is about one block on one day. Once that block's window has passed (it is over, or it is a new day) the nudge
// is dropped, never sent late (2026-10-19: "Time to start: Gym" at 00:00 for the block of 17:08 the day before, and
// "It's been 508 min" counted from yesterday's start). Pure: a window { date, start, end } (minutes) and a clock in.
const MIN = 60_000;
const at = (date, minute) => { const [y, m, d] = String(date).split("-").map(Number); return new Date(y, m - 1, d, 0, minute).getTime(); };
const valid = (w) => w && /^\d{4}-\d{2}-\d{2}$/.test(String(w.date)) && Number.isFinite(w.start) && Number.isFinite(w.end);

export const windowOf = ({ date, start, end }) => (valid({ date, start: Number(start), end: Number(end) }) ? { date, start: Number(start), end: Number(end) } : null);

/** When the block ends, as an ISO time: after this a message about it is pointless. */
export const validUntilOf = (w) => (valid(w) ? new Date(at(w.date, w.end)).toISOString() : null);

/** Minutes since the block's own start (today's), never negative; null when the start is unknown. */
export const elapsedSince = (w, nowMs) => (valid(w) ? Math.max(0, Math.floor((nowMs - at(w.date, w.start)) / MIN)) : null);

/**
 * Why a nudge for this block must not be sent now, or null.
 * With the window: over, or a different day. Without one (a loop made before windows were kept): created on an earlier day.
 */
export function staleReason({ window = null, createdAt = null }, nowMs) {
  const today = new Date(nowMs).toLocaleDateString("en-CA");
  if (valid(window)) {
    if (window.date !== today) return window.date < today ? "yesterday's block" : "a later day's block";
    return nowMs >= at(window.date, window.end) ? "the block is over" : null;
  }
  const made = createdAt ? new Date(createdAt) : null;
  return made && !Number.isNaN(made.getTime()) && made.toLocaleDateString("en-CA") !== today ? "made on an earlier day" : null;
}
