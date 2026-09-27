/**
 * Attention source: things Nick is waiting on.
 *
 * Turns open, un-snoozed waiting-on entries that are overdue or due today
 * into attention items.
 */

/**
 * @param {object} store - The waiting store.
 * @param {{ now: number, maxSurfaced?: number }} options
 * @returns {object[]} Array of attention items.
 */
export function fromWaitingStore(store, { now, maxSurfaced = 3 }) {
  if (
    store == null ||
    typeof store !== "object" ||
    store.version !== 1 ||
    !Array.isArray(store.items)
  ) {
    throw new TypeError("invalid waiting store");
  }

  const today = new Date(now).toISOString().slice(0, 10);

  return store.items.flatMap((entry) => {
    // Skip entries that are not objects
    if (entry == null || typeof entry !== "object") return [];

    // Must be open
    if (entry.status !== "open") return [];

    // Must not be snoozed past now
    if (entry.snoozedUntil && Date.parse(entry.snoozedUntil) > now) return [];

    // dueBy must match YYYY-MM-DD
    if (typeof entry.dueBy !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(entry.dueBy)) {
      return [];
    }

    const dueBy = entry.dueBy;

    // Only overdue or due today
    if (dueBy > today) return [];

    const isOverdue = dueBy < today;

    const title = isOverdue
      ? `Still waiting on ${entry.who}: ${entry.what}`
      : `Due today from ${entry.who}: ${entry.what}`;

    const id = `waiting:${entry.id}`;

    return [{
      id,
      source: "waiting",
      kind: isOverdue ? "overdue" : "due_today",
      title: title.slice(0, 200),
      detail: `Ends when: ${entry.expect}`,
      observedAt: now,
      dueAt: Date.parse(`${dueBy}T23:59:59Z`),
      expiresAt: null,
      dedupKey: id,
      signals: {
        urgency: isOverdue ? 0.85 : 0.6,
        actionability: 0.8,
        novelty: null,
        confidence: 0.8,
        importance: null,
        interruptibility: entry.surfaced >= maxSurfaced ? 0.1 : 0.5,
      },
    }];
  });
}
