/**
 * @param {{ date: string, blocks: Array<{title:string, kind:string, start:number, end:number, fixed:boolean, source:string}>, checkins: Array<{what:string, dueMinute:number, startedMinute:number|null, doneMinute:number|null, phase:string}>, todosDone: string[], now: {date:string, minute:number}, tomorrowFirst?: {title:string, minute:number} }} opts
 * @returns {{ planned: number, done: number, slipped: string[], lateMinutes: number|null, text: string }}
 */
export function reviewDay({ date, blocks, checkins, todosDone, now, tomorrowFirst }) {
  // Validate inputs
  if (typeof date !== "string" || !date) {
    throw new TypeError("date is required");
  }
  if (!Array.isArray(blocks)) {
    throw new TypeError("blocks must be an array");
  }
  if (!Array.isArray(checkins)) {
    throw new TypeError("checkins must be an array");
  }
  if (!Array.isArray(todosDone)) {
    throw new TypeError("todosDone must be an array");
  }
  if (!now || typeof now !== "object" || !("date" in now) || !("minute" in now)) {
    throw new TypeError("now must have date and minute");
  }

  // Decision 1: Planned = ORION blocks that ended by now, excluding rest kind and Wind down/Break titles
  const plannedBlocks = blocks.filter((b) => {
    if (b.source !== "orion") return false;
    if (b.end > now.minute) return false;
    if (b.kind === "rest") return false;
    if (b.title === "Wind down" || b.title === "Break") return false;
    return true;
  });

  // Decision 6: No planned blocks
  if (plannedBlocks.length === 0) {
    return {
      planned: 0,
      done: 0,
      slipped: [],
      lateMinutes: null,
      text: "Nothing was planned today.",
    };
  }

  // Decision 2: A block is done when a check-in whose `what` shares a 4+ letter word with its title (case-insensitive) is `done`, or a to-do in `todosDone` does.
  const doneTitles = new Set();

  for (const block of plannedBlocks) {
    const blockWords = getLongWords(block.title);

    // Check check-ins
    for (const ci of checkins) {
      if (ci.phase !== "done") continue;
      const ciWords = getLongWords(ci.what);
      if (sharesWord(blockWords, ciWords)) {
        doneTitles.add(block.title);
        break;
      }
    }

    // Check todosDone
    if (!doneTitles.has(block.title)) {
      for (const todo of todosDone) {
        const todoWords = getLongWords(todo);
        if (sharesWord(blockWords, todoWords)) {
          doneTitles.add(block.title);
          break;
        }
      }
    }
  }

  const doneCount = doneTitles.size;

  // Decision 3: Slipped = planned and not done
  const slipped = plannedBlocks
    .filter((b) => !doneTitles.has(b.title))
    .map((b) => b.title);

  // Decision 4: lateMinutes = median of (startedMinute - dueMinute) over check-ins that started, rounded; null if none
  let lateMinutes = null;
  const delays = checkins
    .filter((ci) => ci.startedMinute !== null && ci.startedMinute !== undefined)
    .map((ci) => ci.startedMinute - ci.dueMinute);

  if (delays.length > 0) {
    // Create a copy to sort, avoiding mutation of input-derived array if possible, though map returns new array
    const sortedDelays = [...delays].sort((a, b) => a - b);
    const mid = Math.floor(sortedDelays.length / 2);
    lateMinutes = sortedDelays.length % 2 !== 0
      ? Math.round(sortedDelays[mid])
      : Math.round((sortedDelays[mid - 1] + sortedDelays[mid]) / 2);
  }

  // Decision 5: text construction
  let text = `Today: ${doneCount} of ${plannedBlocks.length} planned blocks done.`;

  if (slipped.length > 0) {
    const listed = slipped.slice(0, 3);
    let slippedPart = listed.join(", ");
    if (slipped.length > 3) {
      slippedPart += `, and ${slipped.length - 3} more`;
    }
    text += ` Slipped: ${slippedPart}.`;
  }

  if (lateMinutes !== null && lateMinutes >= 10) {
    text += ` You started things about ${lateMinutes} min late.`;
  }

  if (tomorrowFirst && typeof tomorrowFirst === "object" && "title" in tomorrowFirst && "minute" in tomorrowFirst) {
    const clock = minuteToClock(tomorrowFirst.minute);
    text += ` Tomorrow starts with ${tomorrowFirst.title} at ${clock}.`;
  }

  return {
    planned: plannedBlocks.length,
    done: doneCount,
    slipped,
    lateMinutes,
    text,
  };
}

/**
 * Extract words of length >= 4 from a string, lowercased.
 */
function getLongWords(str) {
  return str.toLowerCase().replace(/[^a-z0-9\s]/g, "").split(/\s+/).filter((w) => w.length >= 4);
}

/**
 * Check if two word sets share at least one common word.
 */
function sharesWord(wordsA, wordsB) {
  const setB = new Set(wordsB);
  return wordsA.some((w) => setB.has(w));
}

/**
 * Convert minutes after midnight to 12-hour clock string like "8:15 PM".
 */
function minuteToClock(minute) {
  let h = Math.floor(minute / 60);
  const m = minute % 60;
  const ampm = h >= 12 ? "PM" : "AM";
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${String(m).padStart(2, "0")} ${ampm}`;
}
