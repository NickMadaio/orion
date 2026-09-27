/**
 * Calculate urgency from due time.
 *
 * @param {number|null} dueAt - Due time in ms (safe integer) or null
 * @param {number} now - Current time in ms (safe integer)
 * @returns {number|null} Urgency in [0,1] or null if no due time
 */
export function urgencyFromDue(dueAt, now) {
  // Validate now: must be a safe integer
  if (!Number.isSafeInteger(now)) {
    throw new TypeError("invalid time");
  }

  // Handle null dueAt
  if (dueAt === null) {
    return null;
  }

  // Validate dueAt: must be a safe integer
  if (!Number.isSafeInteger(dueAt)) {
    throw new TypeError("invalid time");
  }

  const hours = (dueAt - now) / 3_600_000;

  if (hours <= 0) return 1;
  if (hours <= 1) return 0.95;
  if (hours <= 6) return 0.8;
  if (hours <= 24) return 0.6;
  if (hours <= 72) return 0.4;
  if (hours <= 168) return 0.25;
  return 0.1;
}
