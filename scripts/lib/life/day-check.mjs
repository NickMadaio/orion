// The rules a day ORION writes must keep (2026-10-01). Nick: "even after you
// reviewed and fixed it yourself there was still overlaps. thats not a small hey
// keep this in mind, that a design flaw we need to polish out." Until now each
// fix was "this case should not overlap". This is the invariant itself, checked
// on the finished plan BEFORE anything reaches his calendar.
//
//   hard  no block ORION places or moves may overlap anything;
//         every block starts before it ends and is at least 5 minutes.
//   soft  (reported, not refused) two of his own fixed events overlapping —
//         his call, not ours.

const overlaps = (a, b) => a.start < b.end && b.start < a.end;
const mine = (b) => b.source === "orion" || b.fixed === false;

/**
 * @param allBlocks the whole planned day: [{ id, title, start, end, fixed, source }]
 * @param from      minute of "now": only the day from here on is judged
 * @returns { ok, problems: string[], notes: string[] }
 */
export function checkDay(allBlocks, { from = 0 } = {}) {
  if (!Array.isArray(allBlocks)) throw new TypeError("checkDay needs the day's blocks");
  // Only what is still ahead can be wrong: the part of the day before `from` already happened.
  const blocks = allBlocks.filter((b) => b.end > from).map((b) => ({ ...b, start: Math.max(b.start, from) }));
  const problems = []; const notes = [];
  for (const b of blocks) {
    if (!(Number.isFinite(b.start) && Number.isFinite(b.end)) || b.end <= b.start) problems.push(`${b.title} has no length`);
    else if (mine(b) && b.end - b.start < 5) problems.push(`${b.title} is shorter than 5 minutes`);
  }
  const sorted = [...blocks].sort((a, b) => a.start - b.start);
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length && sorted[j].start < sorted[i].end; j++) {
      const [a, b] = [sorted[i], sorted[j]];
      if (!overlaps(a, b)) continue;
      if (mine(a) || mine(b)) problems.push(`${a.title} (${clock(a.start)}–${clock(a.end)}) overlaps ${b.title} (${clock(b.start)}–${clock(b.end)})`);
      else notes.push(`two of his own plans overlap: ${a.title} and ${b.title}`);
    }
  }
  return { ok: problems.length === 0, problems, notes };
}

function clock(m) { return `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; }
