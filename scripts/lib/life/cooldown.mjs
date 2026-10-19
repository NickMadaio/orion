// A to-do that slipped or was given up on 2+ times in the last 3 days cools down (2026-10-19): it is not planned
// again automatically; he is asked once whether he wants it today or later. Read from slips.jsonl; never silent.
const day = (iso) => Date.parse(`${iso}T00:00:00Z`);
const norm = (t) => String(t ?? "").trim().toLowerCase().replace(/\s+/g, " ");

/** @returns {{ slips: number, days: number } | null} null when the to-do has not slipped enough to cool down */
export function cooldownOf(title, slips, date, { days = 3, times = 2 } = {}) {
  const from = day(date) - days * 86400000;
  const rows = slips.filter((r) => r?.date && day(r.date) >= from && day(r.date) < day(date) && norm(r.planned?.title) === norm(title));
  return rows.length >= times ? { slips: rows.length, days: new Set(rows.map((r) => r.date)).size } : null;
}

/** The one question about a cooled-down to-do, in his words. */
export function cooldownAsk(title, { slips, days }) {
  const text = `${title} has slipped ${days >= 2 ? `${days} days` : `${slips} times`}`;
  return `${text[0].toUpperCase()}${text.slice(1)} — want it today, or later this week?`;
}
