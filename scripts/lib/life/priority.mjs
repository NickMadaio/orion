const KINDS = [
  "class",
  "sleep",
  "gym",
  "deadline",
  "study",
  "side_project",
  "meal",
  "other",
  "rest",
];

/** @param {object} block — a life block object */
export function priorityOf(block) {
  // Sleep is his second priority after classes: a nap or wind-down is sleep, not
  // "rest" to be dropped first when the day overflows (2026-10-01).
  if (/\b(nap|wind down|sleep|bed)\b/i.test(String(block.title ?? ""))) return KINDS.indexOf("sleep");
  const index = KINDS.indexOf(block.kind);
  return index < 0 ? KINDS.length : index;
}

/**
 * Explicit importance outranks category defaults during a full rebuild: 0 = must, 2 = optional, 1 = ordinary.
 * Fed by weightOf, but a kind default is not evidence (a Break is ordinary, not optional).
 */
export function importanceOf(block, config = {}) {
  if ([0, 1, 2].includes(block.importance) && !block.rank) return block.importance;
  const { rank, source } = weightOf(block, config);
  if (source === "kind" || source === "fixed" || source === "ranks") return rank === "must" ? 0 : 1;
  return rank === "must" ? 0 : rank === "low" ? 2 : 1;
}

/**
 * Sort comparator: fixed before movable, then priorityOf ascending,
 * then start ascending, then id ascending.
 * @param {object} a
 * @param {object} b
 * @returns {number}
 */
export function comparePriority(a, b) {
  const aMovable = movable(a);
  const bMovable = movable(b);

  // fixed (non-movable) before movable
  if (!aMovable && bMovable) return -1;
  if (aMovable && !bMovable) return 1;

  const pa = priorityOf(a);
  const pb = priorityOf(b);
  const ia = importanceOf(a);
  const ib = importanceOf(b);
  if (ia !== ib) return ia - ib;
  if (pa !== pb) return pa - pb;

  if (a.start !== b.start) return a.start - b.start;

  if (a.id < b.id) return -1;
  if (a.id > b.id) return 1;
  return 0;
}

/** @param {object} block */
export function movable(block) {
  if (block.fixed) return false;
  if (block.kind === "class") return false;
  if (block.kind === "sleep") return false;
  return true;
}

export const RANKS = ["fixed", "must", "high", "medium", "low"];
const MUST_WORDS = /\b(must(?: do| have)?|have to|need to|high priority|important|cannot drop|can't drop)\b/;
const LOW_WORDS = /\b(if (?:there(?:'s| is) time|possible)|maybe|optional|low priority|nice to have)\b/;
const SLEEP_WORDS = /\b(nap|wind down|sleep|bed)\b/;
const result = (rank, source) => ({ rank, score: RANKS.indexOf(rank), source });

/**
 * One weight, computed in code (2026-10-16, spec 3.8). Evidence, first match wins:
 * fixed block, stored rank (block.rank, from a rank-<r> tag), a daily anchor,
 * his saved words (config.ranks), title words / explicit importance, kind default.
 * @returns {{ rank: "fixed"|"must"|"high"|"medium"|"low", score: number, source: string }}
 */
export function weightOf(block, config = {}) {
  const title = String(block.title ?? "").toLowerCase();
  if (block.kind === "class" && block.fixed && block.source !== "orion") return result("fixed", "fixed");
  if (block.fixed) return result("fixed", "fixed");
  if (["must", "high", "medium", "low"].includes(block.rank)) return result(block.rank, "tag");
  const anchor = (config.anchors ?? []).find((a) => a && ((a.title && title === String(a.title).toLowerCase()) || (!a.title && a.kind === block.kind)));
  if (anchor) return result("must", "anchor");
  const mine = Object.entries(config.ranks ?? {}).find(([word, r]) => word && title.includes(word.toLowerCase()) && RANKS.includes(r));
  if (mine) return result(mine[1], "ranks");
  if (block.importance === 0 || MUST_WORDS.test(title)) return result("must", "title");
  if (block.importance === 2 || LOW_WORDS.test(title)) return result("low", "title");
  if (SLEEP_WORDS.test(title)) return result("high", "kind");
  if (["sleep", "gym", "deadline", "study"].includes(block.kind)) return result("high", "kind");
  if (["side_project", "meal", "other"].includes(block.kind)) return result("medium", "kind");
  return result("low", "kind");
}

/** Words ORION can say and reason with; a wrapper over weightOf. */
export function rankOf(block, { ranks = {}, anchors = [] } = {}) {
  return weightOf(block, { ranks, anchors }).rank;
}
