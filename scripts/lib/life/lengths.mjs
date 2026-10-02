// How long things are allowed to be (2026-10-01).
//
// "Naps should be at least an hour and 15 minutes long ALWAYS" and "remember
// that you can change how much time is allotted to non priority items": ORION
// answered "Noted" both times and remembered neither. Minimums live in his life
// config (orion-life min); when the day overflows, the least important movable
// blocks give up time before anything is dropped.
import { priorityOf } from "./priority.mjs";

const SLEEPY = /\b(nap|wind down|sleep|bed)\b/i;
// Lowest priority first: these give up time before anything else does. Not
// "other": his to-dos land there ("finish resume", "send internship
// applications"), and a first run shrank both to make room (2026-10-01).
const SHRINK_ORDER = ["rest", "side_project"];
const OPTIONAL = /\b(optional|maybe|if there'?s time)\b/i;
const shrinkRank = (b) => (OPTIONAL.test(b.title ?? "") ? -1 : SHRINK_ORDER.indexOf(b.kind));
const FLOOR = 20;

/** The minimum he set for anything whose title contains the key ("nap" → 75). */
export function minimumFor(title, minimums = {}) {
  const t = String(title ?? "").toLowerCase();
  return Object.entries(minimums ?? {})
    .filter(([key]) => key && t.includes(key.toLowerCase()))
    .reduce((most, [, minutes]) => Math.max(most, Number(minutes) || 0), 0);
}

/** Planned items with their minutes raised to his minimums (new objects). */
export function withMinimums(items, minimums = {}) {
  return items.map((item) => {
    const least = minimumFor(item.title, minimums);
    return least > item.minutes ? { ...item, minutes: least, raisedFrom: item.minutes } : item;
  });
}

/** Shortest a block may become when the day overflows. */
export function shrinkFloor(block, minimums = {}) {
  const length = block.end - block.start;
  return Math.min(length, Math.max(minimumFor(block.title, minimums), Math.ceil(length / 2), FLOOR));
}

/**
 * Which blocks give up time, and how much, to win back `deficit` minutes.
 * Only movable blocks that have not started: breaks (never naps), side
 * projects, and anything he marked optional; never his to-dos, study, meals
 * or gym. Lowest priority first, later in the day first.
 * @returns [{ id, title, from, to }] lengths in minutes (to < from)
 */
export function shrinkPlan(blocks, deficit, { now = 0, minimums = {} } = {}) {
  if (!Array.isArray(blocks)) throw new TypeError("blocks must be an array");
  if (!(deficit > 0)) return [];
  const candidates = blocks
    .filter((b) => !b.fixed && b.start >= now && !SLEEPY.test(b.title ?? "")
      && (OPTIONAL.test(b.title ?? "") || SHRINK_ORDER.includes(b.kind)) && !["class", "deadline"].includes(b.kind))
    .sort((a, b) => shrinkRank(a) - shrinkRank(b) || priorityOf(b) - priorityOf(a) || b.start - a.start);
  const out = [];
  let left = deficit;
  for (const b of candidates) {
    if (left <= 0) break;
    const length = b.end - b.start;
    const give = Math.min(left, length - shrinkFloor(b, minimums));
    if (give <= 0) continue;
    out.push({ id: b.id, title: b.title, from: length, to: length - give });
    left -= give;
  }
  return out;
}

/**
 * The blocks with the shrink applied (new objects). The time a block gives up
 * is where that block was, and the planner never pulls a block earlier, so the
 * movable blocks after it slide up by what was freed — never past a fixed plan,
 * and never before `now` (a first version freed 30 minutes at 14:28 that the
 * 90-minute block overflowing at 23:00 could not use).
 */
export function applyShrink(blocks, shrunk, { now = 0 } = {}) {
  const to = new Map(shrunk.map((s) => [s.id, s.to]));
  let freed = 0; let wallEnd = now;
  const moved = new Map();
  for (const b of [...blocks].sort((x, y) => x.start - y.start || x.end - y.end)) {
    if (b.fixed) { freed = 0; wallEnd = Math.max(wallEnd, b.end); continue; }
    const length = to.has(b.id) ? to.get(b.id) : b.end - b.start;
    const start = b.start >= now && freed > 0 ? Math.max(b.start - freed, wallEnd, /\bdinner\b/i.test(b.title) ? 18 * 60 + 30 : 0) : b.start;
    moved.set(b.id, { ...b, start, end: start + length });
    if (to.has(b.id)) freed += b.end - b.start - length;
  }
  return blocks.map((b) => moved.get(b.id) ?? b);
}
