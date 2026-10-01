import { isSocial } from "./live-day.mjs";

// Travel time around classes (2026-09-30). ORION put a nap at 12:30 — the minute
// his lab ended — "which he should know i need to commute back to my room for
// that first." On a day with classes, nothing is planned in the commute before
// the first one or after the last one.
export function commuteWalls(blocks, { commuteMinutes = 30 } = {}) {
  if (commuteMinutes <= 0) return [];
  // Real classes only: an ORION block filed as "class" (the to-do "DS lab") made
  // its own travel time and pushed itself two hours later (2026-10-01).
  const classes = blocks.filter((b) => b.kind === "class" && b.fixed && b.source !== "orion").sort((a, b) => a.start - b.start);
  const walls = classes.length ? [
    { start: Math.max(0, classes[0].start - commuteMinutes), end: classes[0].start, title: "commute to class" },
    { start: classes.at(-1).end, end: Math.min(1440, classes.at(-1).end + commuteMinutes), title: "commute home" },
  ] : [];
  // Plans away from home (soccer practice, a night out) need getting there and
  // back too: dinner landed the minute soccer ended (2026-09-30 test day).
  const away = blocks.filter((b) => b.fixed && b.kind !== "class" && isSocial(b.title));
  return [...walls, ...away.flatMap((b) => [
    { start: Math.max(0, b.start - commuteMinutes), end: b.start, title: `getting to ${b.title}` },
    { start: b.end, end: Math.min(1440, b.end + commuteMinutes), title: `getting back from ${b.title}` },
  ])];
}

/** The same walls as fixed pseudo-blocks, for code that finds gaps in a block list. */
export function commuteBlocks(blocks, options) {
  const date = blocks[0]?.date;
  return commuteWalls(blocks, options).map((w, i) => ({ id: `commute-${i}`, title: w.title, kind: "other", date, start: w.start, end: w.end, fixed: true, source: "orion" }));
}
