// What to do with time freed by finishing early (2026-10-06). Nick: "lets say I
// finish working on orion stuff early. I tell it I'm done and it re-works my
// schedule. It might add a break, or maybe some more work, or maybe add time to
// something that was already a bit short on time." Pure; minutes of the day.
import { minimumFor } from "./lengths.mjs";

const RESTFUL = /\b(break|nap|lunch|dinner|breakfast|meal|rest|wind down)\b/i;
const SIDE = /\b(side project|youtube)\b/i;
const overlaps = (a, b) => a.start < b.end && b.start < a.end;

/** A break when he has just worked an hour or more and something work-like is next. */
export function breakFor({ day, finished, now, freed }) {
  const worked = now - finished.start;
  const next = day.filter((b) => b.start >= now).sort((a, b) => a.start - b.start)[0];
  if (worked < 60 || freed < 20 || (next && RESTFUL.test(next.title)) || RESTFUL.test(finished.title)) return null;
  return { start: now, end: now + 15 };
}

/** The first later block that is short of what it should have: his minimum, or the daily side-project hour. */
export function shortBlock(day, { now, minimums = {} }) {
  const later = day.filter((b) => !b.fixed && b.start >= now).sort((a, b) => a.start - b.start);
  const sideMinimum = Object.entries(minimums).find(([k]) => SIDE.test(k))?.[1] ?? 0;
  const sideToday = day.filter((b) => SIDE.test(b.title)).reduce((s, b) => s + b.end - b.start, 0);
  for (const b of later) {
    let deficit = Math.max(0, minimumFor(b.title, minimums) - (b.end - b.start));
    if (!deficit && SIDE.test(b.title) && sideMinimum) deficit = Math.max(0, sideMinimum - sideToday);
    if (deficit > 0) return { block: b, deficit };
  }
  return null;
}

/**
 * Lengthen `target` by up to `want` minutes, pushing the movable blocks after it
 * later by the same amount, never into a fixed block or past `dayEnd`.
 * @returns { by, day } — `by` 0 when nothing fits.
 */
export function extendWithin(day, target, want, { buffer = 5, dayEnd = 1440 } = {}) {
  for (let by = Math.floor(want / 5) * 5; by >= 5; by -= 5) {
    const next = day.map((b) => {
      if (b.id === target.id) return { ...b, end: b.end + by };
      if (!b.fixed && b.start > target.start) return { ...b, start: b.start + by, end: b.end + by };
      return b;
    });
    const moved = next.filter((b) => !b.fixed && b.start >= target.start);
    const clash = moved.some((m) => m.end > dayEnd || next.some((o) => o.id !== m.id && (o.fixed || !moved.includes(o))
      && overlaps({ start: m.start - buffer, end: m.end + buffer }, o)));
    if (!clash) return { by, day: next };
  }
  return { by: 0, day };
}
