// Travel time around classes (2026-09-30). ORION put a nap at 12:30 — the minute
// his lab ended — "which he should know i need to commute back to my room for
// that first." On a day with classes, nothing is planned in the commute before
// the first one or after the last one.
export function commuteWalls(blocks, { commuteMinutes = 30 } = {}) {
  const classes = blocks.filter((b) => b.kind === "class").sort((a, b) => a.start - b.start);
  if (!classes.length || commuteMinutes <= 0) return [];
  const first = classes[0], last = classes.at(-1);
  return [
    { start: Math.max(0, first.start - commuteMinutes), end: first.start, title: "commute to class" },
    { start: last.end, end: Math.min(1440, last.end + commuteMinutes), title: "commute home" },
  ];
}

/** The same walls as fixed pseudo-blocks, for code that finds gaps in a block list. */
export function commuteBlocks(blocks, options) {
  const date = blocks[0]?.date;
  return commuteWalls(blocks, options).map((w, i) => ({ id: `commute-${i}`, title: w.title, kind: "other", date, start: w.start, end: w.end, fixed: true, source: "orion" }));
}
