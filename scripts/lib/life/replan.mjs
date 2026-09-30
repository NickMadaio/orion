// Re-plan a day around what happened (2026-09-29). Nick: "ill tell him xyz
// happened and he should move things that he can around. small things like
// studying, sleep, playing games, relax time, groceries … plans with friends
// are different, cant move those or classes."
//
// Stable by design: only movable blocks that now clash (with something fixed,
// something new, or time already lost) move, each to the nearest free time at
// or after where it was, most important first. What cannot fit is reported,
// never silently dropped.
import { freeGaps } from "./gaps.mjs";
import { priorityOf } from "./priority.mjs";

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

/**
 * @param blocks   the day's blocks (fixed ones never move)
 * @param changes  { now, window: {start,end}, blocked: [{start,end,title}], add: [{title, kind, minutes, at?, fixed?, before?}] }
 * @returns { blocks, moves: [{id,title,from,to}], created: [block], unplaced: [{title, minutes}] }
 */
export function replan(blocks, { now, window, blocked = [], add = [] }) {
  const date = blocks[0]?.date ?? add[0]?.date ?? null;
  const floor = Math.max(window.start, now);
  const walls = [
    ...blocks.filter((b) => b.fixed),
    ...blocked.map((b, i) => ({ id: `blocked-${i}`, title: b.title ?? "busy", kind: "other", start: b.start, end: b.end, fixed: true })),
    ...add.filter((a) => a.fixed && Number.isInteger(a.at)).map((a, i) => ({ id: `new-fixed-${i}`, title: a.title, kind: a.kind ?? "other", date,
      start: a.at, end: a.at + a.minutes, fixed: true, source: "nick" })),
  ];
  const created = walls.filter((w) => w.id.startsWith("new-fixed-"));
  const movable = blocks.filter((b) => !b.fixed);
  // Past or untouched movable blocks stay exactly where they are.
  const stays = movable.filter((b) => b.end <= floor || (b.start >= floor && !walls.some((w) => overlaps(w, b))));
  const toPlace = [
    ...movable.filter((b) => !stays.includes(b)).map((b) => ({ block: b, minutes: b.end - b.start, after: Math.max(floor, b.start), before: window.end })),
    ...add.filter((a) => !(a.fixed && Number.isInteger(a.at))).map((a, i) => ({
      block: { id: `new-${i}`, title: a.title, kind: a.kind ?? "other", date, start: null, end: null, fixed: false, source: "orion" },
      minutes: a.minutes, after: Math.max(floor, Number.isInteger(a.at) ? a.at : floor), before: Number.isInteger(a.before) ? a.before : window.end, fresh: true })),
  // What he already planned goes back in before anything ORION suggests; within
  // each group, most important first. (A scenario run put the side-project hour
  // ahead of the cleaning he had said he'd do first.)
  ].sort((x, y) => (x.fresh ? 1 : 0) - (y.fresh ? 1 : 0) || priorityOf(x.block) - priorityOf(y.block) || (x.after - y.after));
  let placedSoFar = [...walls, ...stays];
  const moves = []; const unplaced = []; const placedNew = [];
  for (const item of toPlace) {
    const gaps = freeGaps(placedSoFar, { start: floor, end: window.end }, { minimum: 5 });
    const fits = (g, from) => Math.max(g.start, from) + item.minutes <= Math.min(g.end, item.before);
    // Nearest at or after where it was; else anywhere later today before its limit.
    const gap = gaps.find((g) => g.end > item.after && fits(g, item.after)) ?? gaps.find((g) => fits(g, floor));
    if (!gap) { unplaced.push({ title: item.block.title, minutes: item.minutes, id: item.block.id }); continue; }
    const start = Math.max(gap.start, gaps.includes(gap) && gap.end > item.after && fits(gap, item.after) ? item.after : floor);
    const placed = { ...item.block, start, end: start + item.minutes };
    placedSoFar = [...placedSoFar, placed];
    if (item.fresh) placedNew.push(placed);
    else if (placed.start !== item.block.start) moves.push({ id: item.block.id, title: item.block.title, from: item.block.start, to: placed.start });
  }
  const result = placedSoFar.filter((b) => !b.id.startsWith("blocked-")).sort((a, b) => a.start - b.start);
  return { blocks: result, moves, created: [...created, ...placedNew], unplaced };
}
