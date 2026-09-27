// Pure summary over automation history entries. No I/O, no mutation.
export const SUPPRESSION_REASONS = [
  "quiet_hours", "focus_active", "focus_unknown",
  "mode_mismatch", "expired", "daily_limit",
];

const DAY_MS = 86400000;

function safeInt(v) { return Number.isSafeInteger(v) && v >= 0; }

export function summarizeAutomationHistory(entries, { from, windowDays }) {
  if (!Array.isArray(entries)) throw new TypeError("invalid summary options");
  if (!Number.isSafeInteger(from) || from < 0) throw new TypeError("invalid summary options");
  if (!Number.isInteger(windowDays) || windowDays < 1 || windowDays > 366)
    throw new TypeError("invalid summary options");

  const windowStart = from - windowDays * DAY_MS;
  const suppressionSet = new Set(SUPPRESSION_REASONS);

  let firings = 0, suppressed = 0, refused = 0;
  let succeeded = 0, failed = 0, unknown = 0;
  let delivered = 0, withheld = 0;
  const byReasonMap = new Map();
  const perDayMap = new Map();

  for (const entry of entries) {
    if (entry === null || typeof entry !== "object") continue;
    const at = entry.at;
    if (!Number.isSafeInteger(at)) continue;
    if (at < windowStart || at >= from) continue;

    // Count by reason
    if (entry.reason != null && typeof entry.reason === "string") {
      byReasonMap.set(entry.reason, (byReasonMap.get(entry.reason) || 0) + 1);
    }

    // Classify by status
    const status = entry.status;
    if (status === "succeeded") {
      firings++; succeeded++;
    } else if (status === "failed") {
      firings++; failed++;
    } else if (status === "outcome_unknown") {
      firings++; unknown++;
    } else if (status === "refused") {
      if (entry.reason && suppressionSet.has(entry.reason)) {
        suppressed++;
      } else {
        refused++;
      }
    }

    // Count deliveries
    if (entry.delivery === "delivered") delivered++;
    else if (entry.delivery === "withheld") withheld++;

    // Per-day bucket
    const dayKey = new Date(at).toISOString().slice(0, 10);
    let dayBucket = perDayMap.get(dayKey);
    if (!dayBucket) {
      dayBucket = { firings: 0, suppressed: 0, delivered: 0 };
      perDayMap.set(dayKey, dayBucket);
    }
    if (status === "succeeded" || status === "failed" || status === "outcome_unknown") {
      dayBucket.firings++;
    } else if (status === "refused" && entry.reason && suppressionSet.has(entry.reason)) {
      dayBucket.suppressed++;
    }
    if (entry.delivery === "delivered") dayBucket.delivered++;
  }

  return {
    windowDays,
    from,
    entries: firings + suppressed + refused,
    observedDays: perDayMap.size,
    firings,
    suppressed,
    refused,
    succeeded,
    failed,
    unknown,
    delivered,
    withheld,
    byReason: Object.fromEntries(byReasonMap),
    perDay: Object.fromEntries(perDayMap),
  };
}
