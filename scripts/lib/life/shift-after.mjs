// "Marketing is running 30 over, shift my stuff after it by 30" (gate run-1031224700, rea-class-late-c). An overrun only
// blocks the extra time and lets the cascade absorb it, so with slack before the gym nothing moved and he heard "nothing could
// be booked". When he asks for the push himself, every one of ORION's movable blocks after the class moves by exactly that
// much. His fixed plans (classes, plans with people) stay walls: a block that would land on one goes straight after it.
// Pure: orion-reschedule writes the result through writeShape (one undo step).

const overlaps = (a, b) => a.start < b.end && b.start < a.end;

/**
 * @param blocks   the day's blocks ({ id, start, end, fixed, pinned }) in minutes
 * @param opts     { from: minute the class now would have ended, minutes, buffer, now }
 * @returns pins   [{ block, start, end }] for every movable block starting at or after `from`, in time order
 */
export function shiftAfter(blocks, { from, minutes, buffer = 0, now = 0 }) {
  const walls = blocks.filter((b) => b.fixed && !b.pinned);
  const movable = blocks.filter((b) => (!b.fixed || b.pinned) && b.start >= from && b.end > now).sort((a, b) => a.start - b.start);
  const pins = [];
  let floor = -Infinity;
  for (const block of movable) {
    const length = block.end - block.start;
    let start = Math.max(block.start + minutes, floor);
    // Past every wall it would sit on (walls can chain).
    for (let wall = walls.find((w) => overlaps(w, { start, end: start + length })); wall; wall = walls.find((w) => overlaps(w, { start, end: start + length }))) {
      start = wall.end + buffer;
    }
    pins.push({ block, start, end: start + length });
    floor = start + length + buffer;
  }
  return pins;
}
