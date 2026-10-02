// Re-plan a day around what happened (2026-09-29). Nick: "ill tell him xyz
// happened and he should move things that he can around. small things like
// studying, sleep, playing games, relax time, groceries … plans with friends
// are different, cant move those or classes."
//
// Three kinds of time (rewritten 2026-09-30, after a day where soccer 5-7 went
// onto a full calendar and every attempt overlapped, refused, or put gym at
// 1 PM before soccer):
//   walls   — classes, plans with people, anything fixed. Never move.
//   pinned  — a time Nick said ("nap at 1"). Placed exactly there; ORION's own
//             blocks get out of its way. Only a wall can push it, and then just
//             past the wall, reported in `shifted`.
//   flexible— everything else, laid out in TIME ORDER (his stated order), each at
//             or after where he wanted it. Importance only decides what is left
//             out when not everything fits; it never reorders the day.
// What cannot fit is reported, never silently dropped.
import { freeGaps } from "./gaps.mjs";
import { importanceOf, priorityOf } from "./priority.mjs";

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

/** First start ≥ from, inside [floor, end], where `minutes` fit among `taken`,
 *  keeping `buffer` minutes clear on each side (2026-10-01: "things are smooshed"). */
function slot(taken, { from, before, minutes, floor, end, buffer = 0 }) {
  const padded = buffer ? taken.map((t) => ({ ...t, start: t.start - buffer, end: t.end + buffer })) : taken;
  const gaps = freeGaps(padded, { start: floor, end }, { minimum: 5 });
  const gap = gaps.find((g) => Math.max(g.start, from) + minutes <= Math.min(g.end, before));
  return gap ? Math.max(gap.start, from) : null;
}

/** Lay items down in time order; returns placed blocks and the ones that did not fit.
 *  Items with a time preference (his existing blocks, "after soccer", "before 5")
 *  go first; untimed suggestions then fill the gaps in the order he listed them. */
function layout(items, taken, { floor, end, buffer = 0 }) {
  const want = (item) => Math.max(item.after, item.prefer ?? item.after);
  const ordered = [...items].sort((x, y) => (x.pref ? 0 : 1) - (y.pref ? 0 : 1) || want(x) - want(y) || x.seq - y.seq);
  let used = [...taken]; const placed = []; const missed = [];
  for (const item of ordered) {
    // Its natural time of day first; if that is full, anything from its floor.
    const start = slot(used, { from: want(item), before: item.before, minutes: item.minutes, floor, end, buffer })
      ?? (want(item) > item.after ? slot(used, { from: item.after, before: item.before, minutes: item.minutes, floor, end, buffer }) : null);
    if (start === null) { missed.push(item); continue; }
    const block = { ...item.block, start, end: start + item.minutes };
    used = [...used, block]; placed.push({ item, block });
  }
  return { placed, missed };
}

/**
 * @param blocks   the day's blocks (fixed ones never move)
 * @param changes  { now, window: {start,end}, blocked, soft?, add, rebuild? }
 *   soft: ORION's own guesses (travel to and from class). Flexible work avoids
 *   them; a time Nick states is placed over them.
 *   add item: { title, kind, minutes, at?, fixed?, after?, before?, prefer?, importance? }
 *   (after is a hard floor; prefer is the natural time of day, used when free)
 * @returns { blocks, moves: [{id,title,from,to}], created: [block],
 *            unplaced: [{title, minutes, id, importance, fresh}], shifted: [{title, from, to, because}] }
 */
export function replan(blocks, { now, window, blocked = [], soft = [], add = [], rebuild = false, buffer = 0, keepFree = 0 }) {
  const date = blocks[0]?.date ?? add[0]?.date ?? null;
  const floor = Math.max(window.start, now);
  const end = window.end;
  const walls = [
    ...blocks.filter((b) => b.fixed),
    ...blocked.map((b, i) => ({ id: `blocked-${i}`, title: b.title ?? "busy", kind: "other", start: b.start, end: b.end, fixed: true })),
    ...add.filter((a) => a.fixed && Number.isInteger(a.at)).map((a, i) => ({ id: `new-fixed-${i}`, title: a.title, kind: a.kind ?? "other", date,
      start: a.at, end: a.at + a.minutes, fixed: true, source: "nick" })),
  ];
  const createdFixed = walls.filter((w) => w.id.startsWith("new-fixed-"));
  const movable = blocks.filter((b) => !b.fixed);
  // What already happened stays. A block under way stays only if its remaining
  // time is clear; one that now runs into something (a class, another block
  // under way) moves like any displaced block. Found by the property tests,
  // 2026-10-01: blocks that were never compared with each other kept overlapping.
  const finished = movable.filter((b) => b.end <= floor);
  const runningNow = movable.filter((b) => b.start < floor && b.end > floor).sort((a, b) => a.start - b.start || a.end - b.end);
  const past = [...finished];
  const interrupted = [];
  for (const b of runningNow) {
    const rest = { start: floor, end: b.end };
    if ([...walls, ...past].some((t) => t.end > floor && overlaps(t, rest))) interrupted.push(b); else past.push(b);
  }

  // 1. Pinned: his own times, in the order of those times. Walls and earlier
  //    pinned items are the only things that can push one, and only just past.
  const newBlock = (a, i) => ({ id: `new-${i}`, title: a.title, kind: a.kind ?? "other", importance: a.importance, date,
    start: null, end: null, fixed: false, source: "orion" });
  const pinnedAsks = add.map((a, i) => ({ a, i })).filter(({ a }) => !a.fixed && Number.isInteger(a.at)).sort((x, y) => x.a.at - y.a.at || x.i - y.i);
  let taken = [...walls, ...past];
  const pinned = []; const shifted = []; const unplaced = []; const lostTime = [];
  for (const { a, i } of pinnedAsks) {
    const wanted = { start: a.at, end: a.at + a.minutes };
    const blocker = taken.find((t) => overlaps(t, wanted));
    if (a.at >= floor && !blocker && wanted.end <= end) {
      const block = { ...newBlock(a, i), start: a.at, end: wanted.end };
      taken = [...taken, block]; pinned.push(block); continue;
    }
    // His time cannot be kept (a wall is there, or it has passed). It is no
    // longer "his time", so it may not push anything: it waits for free time
    // at or after it, like any flexible item, and the shift is reported.
    lostTime.push({ a, i, because: blocker?.title ?? "it was already past" });
  }
  // 2. What stays put. An incremental change keeps every untouched block still;
  //    a rebuild lays all remaining movable work down again.
  // Kept greedily in time order, each checked against everything kept so far —
  // never only against walls (two old blocks overlapping each other used to stay).
  const stays = [];
  if (!rebuild) {
    // …and with the same breathing room as anything newly placed (`buffer`), so
    // ORION's own blocks left edge to edge get spaced out on the next change.
    const near = (t, b) => overlaps({ start: t.start - buffer, end: t.end + buffer }, b);
    for (const b of movable.filter((x) => x.start >= floor).sort((x, y) => x.start - y.start || x.end - y.end)) {
      if (![...taken, ...stays].some((t) => near(t, b))) stays.push(b);
    }
  }
  const softWalls = soft.map((w, k) => ({ id: `blocked-soft-${k}`, title: w.title ?? "travel", kind: "other", start: w.start, end: w.end, fixed: true }))
    .filter((w) => !pinned.some((p) => overlaps(p, w)));

  // 3. Flexible work: displaced blocks go back at or after where they were;
  //    new items at or after where he wanted them, in the order he listed them.
  const flexible = [
    ...[...interrupted, ...movable.filter((b) => b.start >= floor && !stays.includes(b))].map((b, k) => ({ block: b, minutes: b.end - b.start,
      after: Math.max(floor, b.start, /\bdinner\b/i.test(b.title) ? 18 * 60 + 30 : 0), before: end, seq: -1000 + k, fresh: false, pref: true })),
    ...lostTime.map(({ a, i }) => ({ block: newBlock(a, i), minutes: a.minutes, after: Math.max(floor, a.at),
      before: Number.isInteger(a.before) ? a.before : end, seq: i, fresh: true, pref: true })),
    ...add.map((a, i) => ({ a, i })).filter(({ a }) => !Number.isInteger(a.at)).map(({ a, i }) => ({ block: newBlock(a, i), minutes: a.minutes,
      after: Math.max(floor, Number.isInteger(a.after) ? a.after : floor), before: Number.isInteger(a.before) ? a.before : end, seq: i, fresh: true,
      ...(Number.isInteger(a.prefer) ? { prefer: a.prefer } : {}),
      pref: Number.isInteger(a.after) || Number.isInteger(a.before) || Number.isInteger(a.prefer) })),
  ];
  // Choose what fits, most important first (his existing plans before ORION's
  // suggestions), then lay the chosen set out in time order.
  const byImportance = [...flexible].sort((x, y) => importanceOf(x.block) - importanceOf(y.block)
    || (x.fresh ? 1 : 0) - (y.fresh ? 1 : 0) || priorityOf(x.block) - priorityOf(y.block) || x.after - y.after);
  const fixedTaken = [...taken, ...stays, ...softWalls];
  // Keep some of the day genuinely free (keepFree): once adding an item would
  // leave less, it is left out — optional first, since they are tried last.
  // Must-haves always go in.
  const freeAfter = (placedBlocks) => freeGaps([...fixedTaken, ...placedBlocks], { start: floor, end }, { minimum: 15 })
    .reduce((sum, g) => sum + g.end - g.start, 0);
  let chosen = [];
  for (const item of byImportance) {
    const trial = layout([...chosen, item], fixedTaken, { floor, end, buffer });
    // Free time limits what is ADDED; it never drops what he already has planned.
    const roomy = !keepFree || !item.fresh || importanceOf(item.block) === 0 || freeAfter(trial.placed.map(({ block }) => block)) >= keepFree;
    if (trial.missed.length === 0 && roomy) chosen = [...chosen, item];
    else unplaced.push({ title: item.block.title, minutes: item.minutes, id: item.block.id, importance: importanceOf(item.block), fresh: item.fresh });
  }
  const { placed } = layout(chosen, fixedTaken, { floor, end, buffer });

  const moves = placed.filter(({ item, block }) => !item.fresh && block.start !== item.block.start)
    .map(({ item, block }) => ({ id: item.block.id, title: item.block.title, from: item.block.start, to: block.start }));
  const placedNew = placed.filter(({ item }) => item.fresh).map(({ block }) => block);
  for (const { a, i, because } of lostTime) {
    const got = placedNew.find((block) => block.id === `new-${i}`);
    if (got) shifted.push({ title: a.title, from: a.at, to: got.start, because });
  }
  const all = [...walls, ...past, ...pinned, ...stays, ...placed.map(({ block }) => block)];
  const result = all.filter((b) => !b.id.startsWith("blocked-")).sort((a, b) => a.start - b.start);
  return { blocks: result, moves, created: [...createdFixed, ...pinned, ...placedNew], unplaced, shifted };
}
