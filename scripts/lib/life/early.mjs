import { commuteWalls } from "./commute.mjs";

const SLEEP_RE = /\b(nap|wind down|sleep|bed)\b/i;

function isRealClass(b) {
  return b.kind === "class" && b.fixed && b.source !== "orion";
}

function isSleepBlock(b) {
  return SLEEP_RE.test(String(b.title ?? ""));
}

/**
 * @param {object[]} blocks
 * @param {{ now: number, commuteMinutes?: number }} opts
 * @returns {{ kind: "after-class", classId: string, classTitle: string, classEnd: number } |
 *           { kind: "block", id: string, title: string } |
 *           { kind: "none" }}
 */
export function earlyContext(blocks, { now, commuteMinutes = 45 }) {
  if (!Array.isArray(blocks)) throw new TypeError("blocks must be an array");
  if (!Number.isInteger(now) || now < 0 || now > 1439) throw new TypeError("now must be an integer 0..1439");

  // Only the class currently under way. A past class must not steal the
  // button from a later task, or make a second tap lengthen the commute.
  const bestClass = blocks.filter(b => isRealClass(b) && b.start < now && now < b.end)
    .sort((a, b) => b.start - a.start)[0] ?? null;

  if (bestClass !== null) {
    return { kind: "after-class", classId: bestClass.id, classTitle: bestClass.title, classEnd: bestClass.end };
  }

  // Otherwise the movable block with start <= now < end
  for (const b of blocks) {
    if (b.fixed === false && b.start <= now && now < b.end) {
      return { kind: "block", id: b.id, title: b.title };
    }
  }

  return { kind: "none" };
}

/**
 * Build the list of wall intervals for a given mode and context.
 * @param {object[]} effectiveBlocks — blocks with clip applied if needed
 * @param {string} mode
 * @param {number} commuteMinutes
 * @param {object|null} clippedClass — the class block being clipped, or null
 * @returns {{ start: number, end: number }[]}
 */
function buildWalls(effectiveBlocks, mode, commuteMinutes, clippedClass) {
  const walls = [];

  // Every fixed block and every sleep-title block is a wall
  for (const b of effectiveBlocks) {
    if (b.fixed || isSleepBlock(b)) {
      walls.push({ start: b.start, end: b.end });
    }
  }

  // Keep the return journey after the shortened final class. If another
  // class is ahead, stay on campus; its later return journey remains a wall.
  for (const w of commuteWalls(effectiveBlocks, { commuteMinutes })) walls.push({ start: w.start, end: w.end });

  return walls;
}

/** Check if interval [aStart, aEnd) overlaps [bStart, bEnd). */
function intervalsOverlap(aStart, aEnd, bStart, bEnd) {
  return aStart < bEnd && bStart < aEnd;
}

/**
 * @param {object[]} blocks
 * @param {{ now: number, mode: string, commuteMinutes?: number, buffer?: number, dayEnd?: number }} opts
 * @returns {{ mode: string, freeFrom: number, shortened: object|null, clipped: object|null, moves: Array<{id,title,from,to}>, unchanged: string[] }}
 */
export function finishEarly(blocks, { now, mode, commuteMinutes = 45, buffer = 5, dayEnd = 1440 }) {
  if (!Array.isArray(blocks)) throw new TypeError("blocks must be an array");
  if (!Number.isInteger(now) || now < 0 || now > 1439) throw new TypeError("now must be an integer 0..1439");
  if (mode !== "block" && mode !== "out-of-class") {
    throw new TypeError(`mode must be "block", "out-of-class" got ${JSON.stringify(mode)}`);
  }

  let shortened = null;
  let clipped = null;
  let freeFrom;
  let targetBlock = null;
  let ctx = null;
  let cls = null;

  if (mode === "block") {
    // Decision 3: the movable block with start <= now < end
    for (const b of blocks) {
      if (b.fixed === false && b.start <= now && now < b.end) {
        targetBlock = b;
        break;
      }
    }
    if (!targetBlock) throw new Error("nothing is under way to finish");

    freeFrom = now;
    shortened = { id: targetBlock.id, title: targetBlock.title, from: targetBlock.end, to: now };
  } else {
    // Decision 4: needs after-class context
    ctx = earlyContext(blocks, { now, commuteMinutes });
    if (ctx.kind !== "after-class") throw new Error("no class just ended");

    cls = blocks.find((b) => b.id === ctx.classId);
    if (!cls) throw new Error("class block not found in blocks");

    const laterClass = blocks.some(b => isRealClass(b) && b.id !== cls.id && b.start >= now);
    freeFrom = laterClass ? now : now + commuteMinutes;

    // If that class's end > now, set clipped
    if (cls.end > now) {
      clipped = { id: cls.id, title: cls.title, end: now };
    }
  }

  // Decision 5: Walls — build with clip applied
  let effectiveBlocks;
  if (clipped !== null) {
    effectiveBlocks = blocks.map((b) => {
      if (b.id === clipped.id) return { ...b, end: clipped.end };
      return b;
    });
  } else {
    effectiveBlocks = blocks;
  }

  // Find the answered class in effectiveBlocks for wall exclusion (works whether clipped or not)
  let answeredClassForWalls = null;
  if (cls) {
    answeredClassForWalls = effectiveBlocks.find((b) => b.id === cls.id);
  }
  const walls = buildWalls(effectiveBlocks, mode, commuteMinutes, answeredClassForWalls);

  // Decision 6: Candidates — movable blocks (fixed === false, not a wall/sleep) with start >= now
  // In block mode also excluding the shortened one
  let candidates = blocks.filter((b) => {
    if (b.fixed) return false;
    if (isSleepBlock(b)) return false;
    if (mode === "block" && targetBlock && b.id === targetBlock.id) return false;
    if (b.start < now) return false;
    return true;
  });

  // Sort by start order (stable — original order for ties)
  candidates.sort((a, b) => a.start - b.start);

  // Decision 7: Pull forward greedily
  let cursor = mode === "block" ? freeFrom + buffer : freeFrom;
  const moves = [];
  const unchanged = [];
  const placed = []; // [{ start, end }] of already-placed candidates

  for (const block of candidates) {
    const length = block.end - block.start;

    // Find earliest start s >= cursor such that:
    //   [s - buffer, s + length + buffer) overlaps no wall and no placed candidate
    //   s + length <= dayEnd
    // We search from cursor up to block.start (never move later).
    let foundS = null;

    for (let tryS = cursor; tryS <= block.start && tryS + length <= dayEnd; tryS++) {
      const intervalStart = tryS - buffer;
      const intervalEnd = tryS + length + buffer;

      let ok = true;
      // Check against walls
      for (const w of walls) {
        if (intervalsOverlap(intervalStart, intervalEnd, w.start, w.end)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      // Check against already-placed candidates
      for (const p of placed) {
        const pIntervalStart = p.start;
        const pIntervalEnd = p.end;
        if (intervalsOverlap(intervalStart, intervalEnd, pIntervalStart, pIntervalEnd)) {
          ok = false;
          break;
        }
      }
      if (!ok) continue;

      foundS = tryS;
      break;
    }

    if (foundS !== null && foundS < block.start) {
      moves.push({ id: block.id, title: block.title, from: block.start, to: foundS });
      placed.push({ start: foundS, end: foundS + length });
      cursor = foundS + length + buffer;
    } else {
      unchanged.push(block.id);
      // Advance cursor past this block if it is ahead of cursor
      const blockEnd = block.end;
      if (blockEnd + buffer > cursor) {
        cursor = blockEnd + buffer;
      }
    }
  }

  return {
    mode,
    freeFrom,
    shortened,
    clipped,
    moves,
    unchanged,
  };
}
