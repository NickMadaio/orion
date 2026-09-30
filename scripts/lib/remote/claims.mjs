/**
 * Classify whether a reply claims an action was done, an inability, or neither.
 *
 * Rules are applied in order; first match wins.
 * 1. Data absence → "none"
 * 2. Inability / cant → "cant"
 * 3. Completion / done → "done"
 * 4. Otherwise → "none"
 */

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Check if a string matches the data-absence pattern:
 *   negation followed within 4 words by a data noun, NOT followed by a capability noun.
 */
function isDataAbsence(reply) {
  const lower = reply.toLowerCase();

  // Data nouns (what's absent)
  const dataNouns = [
    'location',
    'events?',
    'data',
    'anything',
    'deadline',
    'forecast for',
    'record',
    'entry',
    'reminders? due',
  ];

  // Capability nouns (what's missing as a tool) — if present, it's NOT data absence
  const capabilityNouns = [
    'tool',
    'capability',
    'integration',
    'way',
  ];

  // Negation patterns
  const negations = [
    "don't have",
    "doesn't have",
    "do not have",
    "does not have",
    "there's no",
    "there is no",
    "no ",
    "nothing",
    "not enough",
    "i don't see",
    "don't see",
  ];

  for (const neg of negations) {
    const idx = lower.indexOf(neg);
    if (idx === -1) continue;

    // Look at the window after the negation (up to ~4 words ≈ 60 chars)
    const windowStart = idx + neg.length;
    const windowEnd = Math.min(windowStart + 80, lower.length);
    const window = lower.slice(windowStart, windowEnd);

    // Check for data noun in the window
    for (const noun of dataNouns) {
      const pattern = new RegExp(noun.replace('?', '\\w* '), 'i');
      if (!pattern.test(window)) continue;

      // Make sure no capability noun follows within a slightly wider window
      const wideWindow = lower.slice(windowStart, Math.min(windowStart + 120, lower.length));
      const hasCapability = capabilityNouns.some(
        (cap) => new RegExp(`\\b${cap}\\b`, 'i').test(wideWindow),
      );

      if (!hasCapability) {
        return true;
      }
    }
  }

  // Also handle specific phrases from the brief directly
  const directPhrases = [
    "i don't have a location",
    "there's no location",
    "no events",
    "nothing on the calendar",
    "i don't see anything due",
    "not enough data yet",
  ];

  for (const phrase of directPhrases) {
    if (lower.includes(phrase)) return true;
  }

  return false;
}

/**
 * Check if a reply claims inability.
 */
function isCant(reply) {
  const lower = reply.toLowerCase();

  // Direct inability phrases
  const cantPhrases = [
    "i can't",
    "i cannot",
    "am unable to",
    "am not able to",
    "don't have a way to",
    "have no way to",
    "don't have access to",
    "don't have the ability to",
  ];

  for (const phrase of cantPhrases) {
    if (lower.includes(phrase)) return true;
  }

  // "I don't have a (direct|dedicated|built-in)? (\w+ )?(tool|capability|integration|way)"
  const toolPattern = /i don't have a\s+(?:direct|dedicated|built-in)?\s*(?:\w+\s+)?(?:tool|capability|integration|way)/i;
  if (toolPattern.test(lower)) return true;

  // "(that's|it's) (outside|beyond) what I can do"
  const outsidePattern = /(?:that's|it's)\s+(?:outside|beyond)\s+what\s+i\s+can\s+do/i;
  if (outsidePattern.test(lower)) return true;

  // "can't (list|see|read|check|open|send|set) … (through|from) the phone"
  const phonePattern = /can't\s+(?:list|see|read|check|open|send|set)\s+.*?(?:through|from)\s+the\s+phone/i;
  if (phonePattern.test(lower)) return true;

  return false;
}

/**
 * Check if a reply claims completion.
 */
function isDone(reply) {
  const lower = reply.toLowerCase();
  const trimmed = lower.trim();

  // Questions back to Nick do not count as done
  if (trimmed.includes('?')) return false;

  // "done." at start or standalone
  if (/^done\.?\s*$/i.test(trimmed) || /^done\./i.test(lower)) return true;

  // "all set"
  if (lower.includes('all set')) return true;

  // "I've (set|added|scheduled|created|opened|sent|logged|moved|booked|blocked|put|removed|cleared|ticked)"
  const ivePattern = /i've\s+(?:set|added|scheduled|created|opened|sent|logged|moved|booked|blocked|put|removed|cleared|ticked)/i;
  if (ivePattern.test(lower)) return true;

  // "(it's|that's) (set|scheduled|added|booked|in)"
  const itsPattern = /(?:it's|that's)\s+(?:set|scheduled|added|booked|in)/i;
  if (itsPattern.test(lower)) return true;

  // "booked" as a standalone word at the start
  if (/^booked\b/i.test(trimmed)) return true;

  // "set for"
  if (lower.includes('set for')) return true;

  // "reminder set"
  if (lower.includes('reminder set')) return true;

  // "alarm set"
  if (lower.includes('alarm set')) return true;

  // "added (it|that) to"
  const addedPattern = /added\s+(?:it|that)\s+to/i;
  if (addedPattern.test(lower)) return true;

  // "Reverted" or "Removed" at start
  if (/^reverted\b/i.test(trimmed) || /^removed\b/i.test(trimmed)) return true;

  // Edits (Claude, 2026-09-30): "Combined them into…" was the false claim that
  // prompted this list — merged, renamed, replaced and updated are claims too.
  if (/\b(?:combined|merged|renamed|replaced|updated|swapped|ticked (?:it|that) off|marked (?:it|that) (?:done|complete))\b/i.test(trimmed)) return true;

  return false;
}

/**
 * Extract the matched phrase (≤ 60 chars).
 */
function extractPhrase(reply, kind) {
  const lower = reply.toLowerCase();
  const trimmed = reply.trim();

  // Try to find a short representative substring
  if (kind === 'done') {
    // Look for common done phrases
    const patterns = [
      /done\.?\s*/i,
      /all set/i,
      /i've\s+(?:set|added|scheduled|created|opened|sent|logged|moved|booked|blocked|put|removed|cleared|ticked)\w*/i,
      /(?:it's|that's)\s+(?:set|scheduled|added|booked|in)/i,
      /^booked\b/i,
      /set for/i,
      /reminder set/i,
      /alarm set/i,
      /added\s+(?:it|that)\s+to/i,
      /^reverted\b/i,
      /^removed\b/i,
      /\b(?:combined|merged|renamed|replaced|updated|swapped)\b/i,
    ];

    for (const p of patterns) {
      const m = lower.match(p);
      if (m) {
        const phrase = reply.slice(m.index, m.index + m[0].length);
        return phrase.length <= 60 ? phrase : phrase.slice(0, 60);
      }
    }

    // Fallback: first 60 chars
    return trimmed.length <= 60 ? trimmed : trimmed.slice(0, 60);
  }

  if (kind === 'cant') {
    const patterns = [
      /i can't|cannot|am unable to|am not able to|don't have a way to|have no way to|don't have access to|don't have the ability to/i,
      /i don't have a\s+(?:direct|dedicated|built-in)?\s*(?:\w+\s+)?(?:tool|capability|integration|way)/i,
      /(?:that's|it's)\s+(?:outside|beyond)\s+what\s+i\s+can\s+do/i,
      /can't\s+(?:list|see|read|check|open|send|set)\s+.*?(?:through|from)\s+the\s+phone/i,
    ];

    for (const p of patterns) {
      const m = lower.match(p);
      if (m) {
        const phrase = reply.slice(m.index, m.index + m[0].length);
        return phrase.length <= 60 ? phrase : phrase.slice(0, 60);
      }
    }

    // Fallback: first 60 chars
    return trimmed.length <= 60 ? trimmed : trimmed.slice(0, 60);
  }

  return null;
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

/**
 * Classify a reply as claiming done, cant, or none.
 *
 * @param {string} reply - The model's reply text.
 * @param {{ toolsRun?: number }} [opts] - Options.
 * @returns {{ kind: "done" | "cant" | "none", phrase: string | null, needsCheck: boolean }}
 */
export function classifyClaim(reply, opts = {}) {
  if (typeof reply !== 'string') {
    throw new TypeError('reply must be a string');
  }

  const { toolsRun = 0 } = opts;

  if (typeof toolsRun !== 'number' || !Number.isInteger(toolsRun) || toolsRun < 0) {
    throw new TypeError('toolsRun must be a non-negative integer');
  }

  // Rule 1: Data absence → "none" (wins over cant)
  if (isDataAbsence(reply)) {
    return { kind: 'none', phrase: null, needsCheck: false };
  }

  // Rule 2: Inability → "cant"
  if (isCant(reply)) {
    const phrase = extractPhrase(reply, 'cant');
    const needsCheck = toolsRun === 0;
    return { kind: 'cant', phrase, needsCheck };
  }

  // Rule 3: Completion → "done"
  if (isDone(reply)) {
    const phrase = extractPhrase(reply, 'done');
    const needsCheck = toolsRun === 0;
    return { kind: 'done', phrase, needsCheck };
  }

  // Rule 4: Otherwise → "none"
  return { kind: 'none', phrase: null, needsCheck: false };
}
