// Reshape tomorrow after a short night (life-late-night): classes stay, a nap
// goes in after the first class past noon, early heavy work moves later.
import { freeGaps } from "./gaps.mjs";
import { minimumFor } from "./lengths.mjs";

const hhmm = (m) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const byStart = (a, b) => a.start - b.start;

export function adjustForShortSleep(blocks, { sleptMinutes, wake, window, minimums = {} }) {
  if (sleptMinutes >= 420) return { blocks: blocks.map((b) => ({ ...b })), changes: [] };
  let working = blocks.map((b) => ({ ...b }));
  const changes = [];
  const date = blocks[0]?.date;
  // His own minimum wins ("naps at least an hour and 15, always").
  const napLength = Math.max(sleptMinutes < 300 ? 45 : 30, minimumFor("Nap", minimums));
  const afterNoonFixed = working.filter((b) => b.fixed && b.end > 720).sort(byStart)[0];
  const from = afterNoonFixed ? afterNoonFixed.end : 720;
  const napGap = freeGaps(working, { start: Math.max(from, window.start), end: window.end }).find((g) => g.end - g.start >= napLength);
  if (napGap) {
    working = [...working, { id: `nap-${date}`, title: "Nap", kind: "rest", date, start: napGap.start, end: napGap.start + napLength, fixed: false, source: "orion" }];
    changes.push(`Added a ${napLength} min nap at ${hhmm(napGap.start)}`);
  }
  const early = working.filter((b) => !b.fixed && (b.kind === "study" || b.kind === "side_project") && b.start < wake + 120).sort(byStart);
  for (const block of early) {
    const length = block.end - block.start;
    const others = working.filter((b) => b.id !== block.id);
    const gaps = freeGaps(others, { start: Math.max(wake + 120, window.start), end: window.end }).filter((g) => g.end - g.start >= length);
    const target = gaps[gaps.length - 1];
    if (!target) { changes.push(`Could not move ${block.title}`); continue; }
    const start = target.end - length;
    working = [...others, { ...block, start, end: start + length }];
    changes.push(`Moved ${block.title} to ${hhmm(start)}`);
  }
  return { blocks: working.sort(byStart), changes };
}
