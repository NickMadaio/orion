const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

/**
 * @param {number[]} ledger - array of ms timestamps (may contain non-safe-integers)
 * @param {number} now - current time in ms
 * @param {{ maxPerHour?: number, maxPerDay?: number }} limits
 * @returns {{ allowed: boolean, reason: "ok" | "hour_limit" | "day_limit", nextAt: number | null }}
 */
export function canInterrupt(ledger, now, limits = {}) {
  const maxPerHour = limits.maxPerHour ?? 2;
  const maxPerDay = limits.maxPerDay ?? 8;

  // Filter to safe integers only
  const valid = ledger.filter(t => Number.isSafeInteger(t));

  // Hour window: (now - HOUR_MS, now]
  const hourEntries = valid.filter(t => t > now - HOUR_MS && t <= now);
  // Day window: (now - DAY_MS, now]
  const dayEntries = valid.filter(t => t > now - DAY_MS && t <= now);

  if (hourEntries.length >= maxPerHour) {
    const oldestInHour = Math.min(...hourEntries);
    return {
      allowed: false,
      reason: "hour_limit",
      nextAt: oldestInHour + HOUR_MS,
    };
  }

  if (dayEntries.length >= maxPerDay) {
    const oldestInDay = Math.min(...dayEntries);
    return {
      allowed: false,
      reason: "day_limit",
      nextAt: oldestInDay + DAY_MS,
    };
  }

  return { allowed: true, reason: "ok", nextAt: null };
}

/**
 * @param {number[]} ledger - array of ms timestamps
 * @param {number} now - current time in ms
 * @returns {number[]} new ledger with only last 24 hours, sorted ascending
 */
export function recordInterruption(ledger, now) {
  const valid = ledger.filter(t => Number.isSafeInteger(t));

  // Keep entries within (now - DAY_MS, now] plus the new one
  const recent = valid.filter(t => t > now - DAY_MS && t <= now);
  const result = [...recent, now];
  result.sort((a, b) => a - b);
  return result;
}
