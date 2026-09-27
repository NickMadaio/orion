/**
 * De-duplicate attention items by dedupKey within a time window.
 *
 * For each dedupKey group, the newest item (largest observedAt; ties broken by
 * larger id string) is always kept. Older items whose observedAt falls within
 * `windowMs` of that newest item are dropped. Items older than the window are
 * kept as separate occurrences.
 *
 * @param {object[]} items — attention items (never mutated).
 * @param {{ windowMs?: number }} [options]
 * @returns {{ kept: object[], dropped: { id: string, keptId: string }[] }}
 */
export function dedupAttentionItems(items, options = {}) {
  if (!Array.isArray(items)) {
    throw new TypeError("items must be an array");
  }

  const { windowMs = 6 * 3_600_000 } = options;

  // Build groups keyed by dedupKey.
  const groups = new Map();
  for (const item of items) {
    const key = item.dedupKey;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }

  // For each group, determine which items are dropped and which are kept.
  // The newest item (largest observedAt; tie -> larger id string) is the keeper.
  const dropSet = new Set(); // ids of dropped items

  // Comparator for finding the "newest" in a group: observedAt DESC, then id DESC.
  // The first element after sorting is the keeper.
  const newestFirst = (a, b) => {
    if (b.observedAt !== a.observedAt) return b.observedAt - a.observedAt;
    // Larger id string wins ties.
    return b.id > a.id ? 1 : b.id < a.id ? -1 : 0;
  };

  // Comparator for output ordering: observedAt DESC, then id ASC.
  const outputOrder = (a, b) => {
    if (b.observedAt !== a.observedAt) return b.observedAt - a.observedAt;
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  };

  for (const [, group] of groups) {
    const sorted = [...group].sort(newestFirst);
    const newest = sorted[0];

    for (let i = 1; i < sorted.length; i++) {
      const item = sorted[i];
      const age = newest.observedAt - item.observedAt;
      if (age <= windowMs) {
        dropSet.add(item.id);
      }
    }
  }

  // Build the kept list: all items not in dropSet, sorted by observedAt desc,
  // then id asc.
  const kept = items
    .filter((item) => !dropSet.has(item.id))
    .sort(outputOrder);

  // Build the dropped list: in the order encountered after sorting ALL items
  // by observedAt desc (ties broken by id asc for determinism).
  const allSorted = [...items].sort(outputOrder);

  const dropped = [];
  for (const item of allSorted) {
    if (dropSet.has(item.id)) {
      // Find the keptId: the newest item in this dedupKey group.
      const group = groups.get(item.dedupKey);
      const sorted = [...group].sort(newestFirst);
      dropped.push({ id: item.id, keptId: sorted[0].id });
    }
  }

  return { kept, dropped };
}
