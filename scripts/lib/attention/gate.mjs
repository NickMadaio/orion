/**
 * Attention gate: decide where an item goes and why.
 *
 * Rules apply in this exact order (first match wins):
 *  1. Expired -> drop, "expired"
 *  2. Unranked (score null) -> today, "unranked"
 *  3. Quiet hours + urgency < 0.9 -> today, "quiet_hours"
 *  4. Focus active/unknown + urgency < 0.9 -> today, "focus_active" or "focus_unknown"
 *  5. score >= 0.6 -> interrupt, "score"
 *  6. otherwise -> today, "low_score"
 *
 * @param {object} item - attention item with signals
 * @param {object} context - { now, hourOfDay, quietHours, focusActive, score }
 * @returns {{ deliver: boolean, route: string, reason: string }}
 */
export function attentionGate(item, context) {
  const urgency = item.signals.urgency ?? 0;

  // 1. Expired
  if (item.expiresAt !== null && item.expiresAt <= context.now) {
    return { deliver: false, route: "drop", reason: "expired" };
  }

  // 2. Unranked
  if (context.score === null) {
    return { deliver: false, route: "today", reason: "unranked" };
  }

  // 3. Quiet hours
  const inQuiet = isInQuietHours(context.hourOfDay, context.quietHours);
  if (inQuiet && urgency < 0.9) {
    return { deliver: false, route: "today", reason: "quiet_hours" };
  }

  // 4. Focus active or unknown
  if (context.focusActive !== false && urgency < 0.9) {
    const reason = context.focusActive === true ? "focus_active" : "focus_unknown";
    return { deliver: false, route: "today", reason };
  }

  // 5. High enough score
  if (context.score >= 0.6) {
    return { deliver: true, route: "interrupt", reason: "score" };
  }

  // 6. Low score
  return { deliver: false, route: "today", reason: "low_score" };
}

/**
 * Check whether hourOfDay falls inside the quiet window.
 * [s, e] with s < e: quiet when s <= h < e
 * [s, e] with s > e: quiet when h >= s or h < e  (wraps midnight)
 * s === e: never quiet
 * null: never quiet
 */
function isInQuietHours(hourOfDay, quietHours) {
  if (!quietHours || quietHours.length !== 2) return false;
  const [s, e] = quietHours;
  if (s === e) return false;
  if (s < e) {
    return hourOfDay >= s && hourOfDay < e;
  }
  // s > e: wraps midnight
  return hourOfDay >= s || hourOfDay < e;
}
