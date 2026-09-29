/**
 * Expands a weekly template into dated blocks for a specific date.
 *
 * @param {object} template - The weekly template object.
 * @param {string} date - The date string (YYYY-MM-DD) to expand for.
 * @returns {object[]} Array of block objects.
 */
export function blocksForDate(template, date) {
  // --- Validation ---

  if (!template || typeof template !== 'object') {
    throw new TypeError('invalid template');
  }

  const { from, until, skip, entries } = template;

  if (typeof from !== 'string' || typeof until !== 'string') {
    throw new TypeError('invalid template');
  }
  if (!Array.isArray(skip)) {
    throw new TypeError('invalid template');
  }
  if (!Array.isArray(entries)) {
    throw new TypeError('invalid template');
  }

  // Validate entries structure and values
  for (const entry of entries) {
    if (!entry || typeof entry !== 'object') {
      throw new TypeError('invalid template');
    }
    if (typeof entry.id !== 'string' || typeof entry.title !== 'string') {
      throw new TypeError('invalid template');
    }
    if (typeof entry.kind !== 'string') {
      throw new TypeError('invalid template');
    }
    if (typeof entry.weekday !== 'number' || !Number.isInteger(entry.weekday)) {
      throw new TypeError('invalid template');
    }
    if (entry.weekday < 1 || entry.weekday > 7) {
      throw new TypeError('invalid template');
    }
    if (typeof entry.start !== 'number' || typeof entry.end !== 'number') {
      throw new TypeError('invalid template');
    }
    if (!Number.isInteger(entry.start) || !Number.isInteger(entry.end)) {
      throw new TypeError('invalid template');
    }
    if (entry.start < 0 || entry.start > 1439) {
      throw new TypeError('invalid template');
    }
    if (entry.end < 1 || entry.end > 1440) {
      throw new TypeError('invalid template');
    }
    if (entry.start >= entry.end) {
      throw new TypeError('invalid template');
    }
  }

  // --- Date Logic ---

  // Parse date string components
  const [yearStr, monthStr, dayStr] = date.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (isNaN(year) || isNaN(month) || isNaN(day)) {
    throw new TypeError('invalid template'); // Treating bad date as invalid input context
  }

  // Compute weekday for the target date
  // Date.UTC(y, m-1, d) creates a UTC date. getUTCDay() returns 0 (Sun) to 6 (Sat).
  // We map Sunday (0) to 7 to match ISO 1-7.
  const jsDate = new Date(Date.UTC(year, month - 1, day));
  let isoWeekday = jsDate.getUTCDay();
  if (isoWeekday === 0) {
    isoWeekday = 7;
  }

  // Check range [from, until] inclusive
  if (date < from || date > until) {
    return [];
  }

  // Check skip list
  if (skip.includes(date)) {
    return [];
  }

  // --- Expansion ---

  const matchingEntries = entries.filter(e => e.weekday === isoWeekday);

  const blocks = matchingEntries.map(entry => ({
    id: `${entry.id}-${date}`,
    title: entry.title,
    kind: entry.kind,
    date: date,
    start: entry.start,
    end: entry.end,
    fixed: true,
    source: 'template',
  }));

  // Sort by start time
  blocks.sort((a, b) => a.start - b.start);

  return blocks;
}
