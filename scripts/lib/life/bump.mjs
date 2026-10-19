// Auto-bump (2026-10-19): a daily anchor (the gym) that does not fit is made to fit by moving, and failing that
// removing, blocks ranked STRICTLY LOWER than it. Never touched: fixed blocks, a time he stated (pinned), another
// must or an equal rank, anything under way. Blocks keep their length (a saved minimum is never undercut): they only
// move later today, or come off. Pure: reads the day, returns the plan; the caller writes it.
import { replan } from "./replan.mjs";
import { freeGaps } from "./gaps.mjs";
import { movable, weightOf } from "./priority.mjs";

const STEP = 5;
const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const sum = (list) => list.reduce((a, b) => a + b, 0);

/** Lexicographic compare of number arrays. */
function compare(a, b) {
  for (let i = 0; i < Math.max(a.length, b.length); i++) if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) - (b[i] ?? 0);
  return 0;
}

/** One ask at its best start: fewest higher-ranked removals, then fewer removals of any, then fewer moves. */
function bumpOne(day, ask, ctx) {
  const { now, window, blocked = [], soft = [], buffer = 0, config } = ctx;
  const floor = Math.max(window.start, now);
  const anchorScore = weightOf({ ...ask, fixed: false }, config).score;
  const frozen = (b) => !movable(b) || b.fixed || b.pinned || weightOf(b, config).score <= anchorScore;
  const ordered = day.map((b) => (frozen(b) ? { ...b, fixed: true } : b));
  const walls = [...ordered.filter((b) => b.fixed), ...blocked, ...soft];
  const lowest = Math.max(floor, Number.isInteger(ask.after) ? ask.after : floor);
  const latest = Math.min(window.end, Number.isInteger(ask.before) ? ask.before : window.end) - ask.minutes;
  const { at: _at, after: _after, before: _before, ...base } = ask;
  const byId = new Map(day.map((b) => [b.id, b]));
  let best = null;
  for (let s = lowest; s <= latest; s += STEP) {
    const mine = { start: s, end: s + ask.minutes };
    if (walls.some((w) => overlaps({ start: w.start - buffer, end: w.end + buffer }, mine))) continue;
    const result = replan(ordered, { now, window, blocked, soft, add: [{ ...base, at: s }], rebuild: true, buffer, keepFree: 0, config });
    const gym = result.created.find((c) => c.title === ask.title && c.start === s);
    if (!gym || result.shifted.length || result.unplaced.some((u) => u.fresh || u.importance === 0)) continue;
    const gone = result.unplaced.map((u) => byId.get(u.id)).filter(Boolean);
    const scores = gone.map((b) => weightOf(b, config).score);
    const moved = result.moves.filter((m) => m.to !== m.from);
    const cost = [...[2, 3, 4].map((k) => scores.filter((x) => x === k).length), sum(gone.map((b) => b.end - b.start)), moved.length,
      Number.isInteger(ask.prefer) ? Math.abs(s - ask.prefer) : s, s];
    if (!best || compare(cost, best.cost) < 0) best = { cost, result, gone };
  }
  return best ? { ok: true, result: best.result, gone: best.gone } : { ok: false, ordered, floor };
}

/** Why there is no room, in plain words: what holds the day, and the longest open stretch. */
export function noRoomWhy(ask, { blocks, window, now, blocked = [], soft = [] }, clock) {
  const floor = Math.max(window.start, now);
  const holds = [...blocks.filter((b) => b.fixed || b.pinned || !movable(b)), ...blocked].filter((b) => b.end > floor && b.start < window.end)
    .sort((a, b) => a.start - b.start);
  const longest = Math.max(0, ...freeGaps([...holds, ...soft], { start: floor, end: window.end }, { minimum: 5 }).map((g) => g.end - g.start));
  const named = holds.slice(0, 4).map((b) => `${b.title} ${clock(b.start)}–${clock(b.end)}`).join(", ");
  const stretch = longest > 0 ? `the longest open stretch is ${longest} min` : "no open time is left";
  return `No room for ${ask.title} today: it needs ${ask.minutes} min and ${stretch}${named ? `, with ${named} in the way` : ""}.`;
}

/**
 * @param blocks the day's blocks (not yet changed), @param asks the anchors to fit (must-haves)
 * @returns {{ ok: true, result, removed } | { ok: false, ask }} result: { blocks, moves, created, unplaced: [], shifted: [] };
 *   removed: the original blocks that came off today (for the calendar delete, the undo and the slips).
 */
export function bumpAnchors(blocks, asks, ctx) {
  const original = new Map(blocks.map((b) => [b.id, b]));
  let day = blocks; const created = []; const moves = new Map(); const removed = [];
  for (const [i, ask] of asks.entries()) {
    const step = bumpOne(day, ask, ctx);
    if (!step.ok) return { ok: false, ask };
    for (const m of step.result.moves.filter((x) => x.to !== x.from)) {
      const first = moves.get(m.id);
      moves.set(m.id, first ? { ...m, from: first.from } : m);
    }
    removed.push(...step.gone.map((b) => original.get(b.id)).filter(Boolean));
    created.push(...step.result.created);
    const taken = new Set(step.result.created.map((c) => c.id));
    day = step.result.blocks.map((b) => (taken.has(b.id) ? { ...b, id: `anchor-${i}` } : b));
  }
  const kept = [...moves.values()].filter((m) => m.to !== m.from);
  return { ok: true, removed, result: { blocks: day, moves: kept, created, unplaced: [], shifted: [] } };
}
