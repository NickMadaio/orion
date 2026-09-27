import { scoreAttentionItem } from "./score.mjs";
import { attentionGate } from "./gate.mjs";

/**
 * Rank open items into now, later and dropped.
 *
 * @param {object[]} entries - attention queue entries (items with state/surfaced/etc.)
 * @param {object} context - { now, hourOfDay, quietHours?, focusActive? }
 * @returns {{ now: object[], later: object[], dropped: object[] }}
 */
export function rankAttention(entries, context) {
  const now = [];
  const later = [];
  const dropped = [];

  for (const entry of entries) {
    const { score, known, unknown } = scoreAttentionItem(entry);
    const gateCtx = { ...context, score };
    const { route, reason } = attentionGate(entry, gateCtx);

    const row = {
      id: entry.id,
      title: entry.title,
      source: entry.source,
      score,
      reason,
      dueAt: entry.dueAt,
    };

    if (route === "interrupt") {
      now.push(row);
    } else if (route === "today") {
      later.push(row);
    } else {
      // drop
      dropped.push({ id: entry.id, reason });
    }
  }

  const cmp = (a, b) => {
    // score descending, null last
    if (a.score !== null && b.score !== null) {
      if (a.score !== b.score) return b.score - a.score;
    } else if (a.score === null && b.score === null) {
      // both null, fall through to dueAt
    } else if (a.score === null) {
      return 1; // a is null → goes after b
    } else {
      return -1; // b is null → goes after a
    }

    // dueAt ascending, null last
    if (a.dueAt !== null && b.dueAt !== null) {
      if (a.dueAt !== b.dueAt) return a.dueAt - b.dueAt;
    } else if (a.dueAt === null && b.dueAt === null) {
      // both null, fall through to id
    } else if (a.dueAt === null) {
      return 1;
    } else {
      return -1;
    }

    // id ascending
    if (a.id < b.id) return -1;
    if (a.id > b.id) return 1;
    return 0;
  };

  now.sort(cmp);
  later.sort(cmp);

  return { now, later, dropped };
}
