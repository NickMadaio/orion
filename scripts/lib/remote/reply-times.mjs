// Stop words to ignore during title matching
const STOP_WORDS = new Set(["the", "my", "your", "and"]);

/**
 * Parse a 12-hour time: hour (1-12), optional minute, optional AM/PM modifier.
 * Returns minutes after midnight or null on invalid input.
 */
function parse12Hour(hour, minute = 0, modifier) {
  hour = parseInt(hour, 10);
  minute = parseInt(minute, 10);
  if (isNaN(hour) || isNaN(minute)) return null;
  if (hour < 1 || hour > 12) return null;
  if (minute < 0 || minute > 59) return null;

  const mod = (modifier || "").toUpperCase();
  let h = hour;
  if (mod === "PM" && hour !== 12) h = hour + 12;
  if (mod === "AM" && hour === 12) h = 0;
  return h * 60 + minute;
}

/**
 * Parse a 24-hour time: hour (0-23), optional minute.
 * Returns minutes after midnight or null on invalid input.
 */
function parse24Hour(hour, minute = 0) {
  hour = parseInt(hour, 10);
  minute = parseInt(minute, 10);
  if (isNaN(hour) || isNaN(minute)) return null;
  if (hour < 0 || hour > 23) return null;
  if (minute < 0 || minute > 59) return null;
  return hour * 60 + minute;
}

/**
 * Apply bare-hour rules: 1..7 → PM, 8..11 → AM, 12 → PM.
 * Returns the converted 24h hour value, or null if out of range.
 */
function applyBareHourRules(hour) {
  if (hour >= 1 && hour <= 7) return hour + 12; // PM
  if (hour >= 8 && hour <= 11) return hour; // AM
  if (hour === 12) return 12; // PM → 12:00 = 720
  return null;
}

/**
 * Extract up to N words from text around a position.
 */
function getNearWords(text, index, maxWords = 6) {
  const before = text.slice(0, index);
  const after = text.slice(index);
  const beforeWords = before.split(/\s+/).filter(Boolean).slice(-maxWords);
  const afterWords = after.split(/\s+/).filter(Boolean).slice(0, maxWords);
  return [...beforeWords, ...afterWords].join(" ");
}

/**
 * Tokenize reply into mentions of clock times.
 * Returns [{ phrase, minute, near }].
 */
export function mentions(reply) {
  if (typeof reply !== "string") throw new TypeError("reply must be a string");

  const results = [];
  // Track character ranges already consumed so we don't double-count
  const consumedRanges = [];

  function isConsumed(index, length) {
    for (const [s, e] of consumedRanges) {
      if (index < e && index + length > s) return true;
    }
    return false;
  }

  function markConsumed(index, length) {
    consumedRanges.push([index, index + length]);
  }

  // --- Phase 1: Ranges with dash/en-dash ---
  // "2:30–4 PM", "2:30-4:00 PM", "from 2:30 to 4"
  const rangePattern = /(\d{1,2}(?::\d{2})?)\s*[–\-]\s*(\d{1,2}(?::\d{2})?)\s*(AM|PM|am|pm)?/gi;
  let m;
  while ((m = rangePattern.exec(reply)) !== null) {
    const startStr = m[1];
    const endStr = m[2];
    const trailingMod = m[3] || "";
    const fullPhrase = m[0];
    const startIndex = m.index;

    const parseRangeEnd = (str, mod) => {
      if (mod) {
        // Trailing modifier applies to both ends — always 12-hour
        if (str.includes(":")) {
          const [h, min] = str.split(":");
          return parse12Hour(h, min, mod);
        } else {
          return parse12Hour(parseInt(str, 10), 0, mod);
        }
      } else if (str.includes(":")) {
        // No trailing mod, has colon — try 24h first
        const [h, min] = str.split(":");
        let val = parse24Hour(h, min);
        if (val !== null) return val;
        return parse12Hour(h, min, "");
      } else {
        // Bare hour, no trailing mod — apply bare-hour rules
        const hVal = parseInt(str, 10);
        const converted = applyBareHourRules(hVal);
        return converted !== null ? converted * 60 : null;
      }
    };

    const startMinute = parseRangeEnd(startStr, trailingMod);
    const endMinute = parseRangeEnd(endStr, trailingMod);

    if (startMinute !== null && endMinute !== null) {
      const near = getNearWords(reply, startIndex);
      results.push({ phrase: fullPhrase, minute: startMinute, near, isRange: true });
      results.push({ phrase: fullPhrase, minute: endMinute, near, isRange: true });
      markConsumed(startIndex, fullPhrase.length);
    }
  }

  // --- Phase 2: "from X to Y" / "between X and Y" patterns ---
  const fromToPattern = /(?:from|between)\s+(\d{1,2}(?::\d{2})?)\s+(?:to|until|till)\s+(\d{1,2}(?::\d{2})?)\s*(AM|PM|am|pm)?/gi;
  while ((m = fromToPattern.exec(reply)) !== null) {
    const startStr = m[1];
    const endStr = m[2];
    const trailingMod = m[3] || "";
    const fullPhrase = m[0];
    const startIndex = m.index;

    const parseRangeEnd = (str, mod) => {
      if (mod) {
        if (str.includes(":")) {
          const [h, min] = str.split(":");
          return parse12Hour(h, min, mod);
        } else {
          return parse12Hour(parseInt(str, 10), 0, mod);
        }
      } else if (str.includes(":")) {
        const [h, min] = str.split(":");
        let val = parse24Hour(h, min);
        if (val !== null) return val;
        return parse12Hour(h, min, "");
      } else {
        const hVal = parseInt(str, 10);
        const converted = applyBareHourRules(hVal);
        return converted !== null ? converted * 60 : null;
      }
    };

    const startMinute = parseRangeEnd(startStr, trailingMod);
    const endMinute = parseRangeEnd(endStr, trailingMod);

    if (startMinute !== null && endMinute !== null) {
      const near = getNearWords(reply, startIndex);
      results.push({ phrase: fullPhrase, minute: startMinute, near, isRange: true });
      results.push({ phrase: fullPhrase, minute: endMinute, near, isRange: true });
      markConsumed(startIndex, fullPhrase.length);
    }
  }

  // --- Phase 3: "noon" and "midnight" ---
  const noonPattern = /\bnoon\b/gi;
  while ((m = noonPattern.exec(reply)) !== null) {
    if (!isConsumed(m.index, m[0].length)) {
      results.push({ phrase: m[0], minute: 720, near: getNearWords(reply, m.index) });
      markConsumed(m.index, m[0].length);
    }
  }

  const midnightPattern = /\bmidnight\b/gi;
  while ((m = midnightPattern.exec(reply)) !== null) {
    if (!isConsumed(m.index, m[0].length)) {
      results.push({ phrase: m[0], minute: 0, near: getNearWords(reply, m.index) });
      markConsumed(m.index, m[0].length);
    }
  }

  // --- Phase 4: 12-hour times with explicit AM/PM ---
  // "4 PM", "4pm", "4:00 PM", "4:00pm"
  const time12Pattern = /\b(\d{1,2})(?::(\d{2}))?\s*(AM|PM|am|pm)\b/gi;
  while ((m = time12Pattern.exec(reply)) !== null) {
    if (!isConsumed(m.index, m[0].length)) {
      const hour = parseInt(m[1], 10);
      const minute = m[2] !== undefined ? parseInt(m[2], 10) : 0;
      const mod = m[3];
      const minuteVal = parse12Hour(hour, minute, mod);
      if (minuteVal !== null) {
        results.push({ phrase: m[0], minute: minuteVal, near: getNearWords(reply, m.index) });
        markConsumed(m.index, m[0].length);
      }
    }
  }

  // --- Phase 5: 24-hour times "HH:MM" (no AM/PM) ---
  const time24Pattern = /\b(\d{1,2}):(\d{2})\b/g;
  while ((m = time24Pattern.exec(reply)) !== null) {
    if (!isConsumed(m.index, m[0].length)) {
      const h = parseInt(m[1], 10);
      const min = parseInt(m[2], 10);
      const minuteVal = parse24Hour(h, min);
      if (minuteVal !== null) {
        results.push({ phrase: m[0], minute: minuteVal, near: getNearWords(reply, m.index) });
        markConsumed(m.index, m[0].length);
      }
    }
  }

  // --- Phase 6: Bare hours with "at" — only if not part of a HH:MM time ---
  // "at 4", "at 9" — the hour must not be followed by :MM
  const bareAtPattern = /\bat\s+(\d{1,2})(?!\s*:\d{2})\b/gi;
  while ((m = bareAtPattern.exec(reply)) !== null) {
    if (!isConsumed(m.index, m[0].length)) {
      const hour = parseInt(m[1], 10);
      if (hour >= 1 && hour <= 12) {
        const hVal = applyBareHourRules(hour);
        if (hVal !== null) {
          results.push({ phrase: m[0], minute: hVal * 60, near: getNearWords(reply, m.index) });
          markConsumed(m.index, m[0].length);
        }
      }
    }
  }

  return results;
}

/**
 * Score how well a block title matches the near-text of a mention.
 * Counts shared words of 4+ letters, case-insensitive, ignoring stop words.
 */
function matchScore(title, nearText) {
  const titleWords = new Set(
    title.toLowerCase().split(/\s+/).filter(w => w.length >= 4 && !STOP_WORDS.has(w))
  );
  const nearWords = nearText.toLowerCase().split(/\s+/).filter(w => w.length >= 4 && !STOP_WORDS.has(w));

  let score = 0;
  for (const word of nearWords) {
    if (titleWords.has(word)) score++;
  }
  return score;
}

/**
 * Check reply times against booked blocks.
 */
export function checkReplyTimes(reply, booked) {
  if (typeof reply !== "string") throw new TypeError("reply must be a string");
  if (!Array.isArray(booked)) throw new TypeError("booked must be an array");

  for (const block of booked) {
    if (typeof block.title !== "string") throw new TypeError("each block must have a string title");
    if (typeof block.start !== "number" || typeof block.end !== "number") {
      throw new TypeError("each block must have numeric start and end");
    }
  }

  const mentionList = mentions(reply);
  const mismatches = [];
  const unmatched = [];
  const matchedBlockIndices = new Set();

  for (let i = 0; i < mentionList.length; i++) {
    const mention = mentionList[i];
    let bestBlock = null;
    let bestBlockIndex = -1;
    let bestScore = -1;
    let bestDist = Infinity;

    for (let bi = 0; bi < booked.length; bi++) {
      if (matchedBlockIndices.has(bi)) continue;
      const block = booked[bi];
      const score = matchScore(block.title, mention.near);
      if (score > 0) {
        const dist = Math.abs(block.start - mention.minute);
        if (score > bestScore || (score === bestScore && dist < bestDist)) {
          bestBlock = block;
          bestBlockIndex = bi;
          bestScore = score;
          bestDist = dist;
        }
      }
    }

    if (bestBlock) {
      matchedBlockIndices.add(bestBlockIndex);
      // Check if the mention's minute equals start or end of the block
      const matchesStart = mention.minute === bestBlock.start;
      const matchesEnd = mention.isRange && mention.minute === bestBlock.end;
      if (!matchesStart && !matchesEnd) {
        mismatches.push({
          title: bestBlock.title,
          said: mention.minute,
          booked: bestBlock.start,
        });
      }
    } else {
      unmatched.push(mention.phrase);
    }
  }

  return {
    ok: mismatches.length === 0,
    mismatches,
    unmatched,
  };
}
