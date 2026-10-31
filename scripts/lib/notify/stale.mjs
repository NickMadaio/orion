// A held update is a claim about a moment. Once the moment is gone the claim is false, so the digest must not say it.
// 2026-10-31: a Friday "Heads up 3:30 PM - MKTG2201" sat in remote.json's deferred queue and went out Saturday afternoon
// when the app launched and the proactive tick flushed everything held. Stale items are dropped, never delivered.

export const HELD_MAX_AGE_MS = 6 * 3_600_000;
const HEADS_UP = /\b(?:heads[- ]?up|starts?|starting|begins?|leave|at)\b[^0-9]{0,12}(\d{1,2})(?::(\d{2}))?\s*([ap])\.?m\b/i;
const EVERGREEN = /\b(complete|blocked|decision)\b/;

/** The moment a "Heads up 3:30 PM" message is about: the first such time at or after when it was held. null if none. */
export function subjectTime(message, heldAt) {
  const m = HEADS_UP.exec(String(message ?? ""));
  if (!m) return null;
  let hour = Number(m[1]) % 12;
  if (m[3].toLowerCase() === "p") hour += 12;
  const t = new Date(heldAt);
  t.setHours(hour, Number(m[2] ?? 0), 0, 0);
  if (t.getTime() < heldAt) t.setDate(t.getDate() + 1);
  return t.getTime();
}

/** Why a held entry must be dropped now, or null when it is still worth saying. */
export function staleReason(entry, now, { maxAgeMs = HELD_MAX_AGE_MS } = {}) {
  const heldAt = Number(entry.at);
  if (!Number.isFinite(heldAt)) return "no timestamp";
  const when = subjectTime(entry.message, heldAt);
  if (when !== null && now >= when) return "its time has passed";
  if (entry.validUntil && Date.parse(entry.validUntil) < now) return "past its validUntil";
  if (!EVERGREEN.test(String(entry.event ?? "")) && now - heldAt > maxAgeMs) return "held longer than its relevance window";
  return null;
}

/** { fresh, stale } -- pure; the caller logs and persists. */
export function partitionDeferred(entries, now, opts) {
  const fresh = [], stale = [];
  for (const e of entries) {
    const reason = staleReason(e, now, opts);
    (reason ? stale : fresh).push(reason ? { entry: e, reason } : e);
  }
  return { fresh, stale };
}
