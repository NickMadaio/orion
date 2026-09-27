/**
 * Calculates the novelty score for a dedupKey based on recent surfacing history.
 *
 * @param {string} dedupKey - The key to check.
 * @param {Array<{dedupKey: string, surfacedAt: number}>} [history] - Array of surfacing records.
 * @param {number} now - Current time in milliseconds.
 * @returns {number} Novelty score between 0 and 1.
 */
export function noveltyOf(dedupKey, history, now) {
  // Treat non-array history as empty
  if (!Array.isArray(history)) {
    history = [];
  }

  const sevenDaysMs = 7 * 86_400_000;
  const windowStart = now - sevenDaysMs;

  let count = 0;

  for (const entry of history) {
    // Skip malformed entries: must be an object, have string dedupKey, and safe integer surfacedAt
    if (entry === null || typeof entry !== 'object') {
      continue;
    }

    const key = entry.dedupKey;
    const time = entry.surfacedAt;

    // Validate types
    if (typeof key !== 'string') {
      continue;
    }
    
    // Check for safe integer: must be a number, finite, and equal to its integer value
    if (typeof time !== 'number' || !Number.isFinite(time) || Math.floor(time) !== time) {
      continue;
    }

    // Check if it matches the key and is within the window [windowStart, now]
    if (key === dedupKey && time >= windowStart && time <= now) {
      count++;
    }
  }

  // Map count to novelty score
  if (count === 0) return 1;
  if (count === 1) return 0.6;
  if (count === 2) return 0.35;
  return 0.1; // 3 or more
}
