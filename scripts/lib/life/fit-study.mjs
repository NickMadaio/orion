// Fit study sessions into a day (life-fit-study). Free gaps first; then move a
// lower-priority movable block out of the way; classes, sleep, gym and
// deadlines never move, and side-project time is moved but never shortened.
import { freeGaps } from "./gaps.mjs";
import { priorityOf } from "./priority.mjs";

const MOVABLE_FOR_STUDY = new Set(["side_project", "meal", "other", "rest"]);
const byStart = (a, b) => a.start - b.start || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

export function fitStudy(blocks, sessions, window, now, date) {
  const day = blocks[0]?.date ?? date ?? window?.date;
  if (!day) throw new TypeError("no date");
  let working = blocks.map((b) => ({ ...b }));
  const placed = [];
  const moved = [];
  const unplaced = [];
  const floor = Math.max(window.start, now ?? window.start);
  const open = () => freeGaps(working, { start: floor, end: window.end }, { buffer: 10, minimum: 5 });

  [...sessions].map((m, i) => ({ m, i })).sort((a, b) => b.m - a.m || a.i - b.i).forEach(({ m }) => {
    let gap = open().find((g) => g.end - g.start >= m);
    if (!gap) {
      // Lowest priority first (rest, then other, meal, side project).
      const candidates = working
        .filter((b) => !b.fixed && MOVABLE_FOR_STUDY.has(b.kind) && b.start >= floor)
        .sort((a, b) => priorityOf(b) - priorityOf(a) || byStart(a, b));
      for (const candidate of candidates) {
        const without = working.filter((b) => b.id !== candidate.id);
        const gaps = freeGaps(without, { start: floor, end: window.end }, { buffer: 10, minimum: 5 });
        const room = gaps.find((g) => g.start <= candidate.start && g.end >= candidate.end && g.end - g.start >= m);
        if (!room) continue;
        const length = candidate.end - candidate.start;
        // The study session takes the start of the freed room; the candidate goes to
        // the latest gap that still fits it after that.
        const studyAt = { start: room.start, end: room.start + m };
        const after = freeGaps([...without, { ...studyAt, fixed: false }], { start: floor, end: window.end }, { buffer: 10, minimum: 5 })
          .filter((g) => g.end - g.start >= length);
        const target = after[after.length - 1];
        if (!target) continue;
        const to = target.end - length;
        moved.push({ id: candidate.id, from: candidate.start, to });
        working = [...without, { ...candidate, start: to, end: to + length }];
        gap = studyAt;
        break;
      }
    }
    if (!gap) { unplaced.push(m); return; }
    const block = { id: `study-${day}-${placed.length + 1}`, title: "Study", kind: "study", date: day,
                    start: gap.start, end: gap.start + m, fixed: false, source: "orion" };
    placed.push(block);
    working = [...working, block];
  });
  return { blocks: working.sort(byStart), placed, moved, unplaced };
}
