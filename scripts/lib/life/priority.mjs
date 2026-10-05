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

/** Explicit user importance outranks category defaults during a full rebuild. */
export function importanceOf(block) {
  if ([0, 1, 2].includes(block.importance)) return block.importance;
  const title = String(block.title ?? "").toLowerCase();
  if (/\b(must(?: do| have)?|have to|need to|high priority|important|cannot drop|can't drop)\b/.test(title)) return 0;
  if (/\b(if (?:there(?:'s| is) time|possible)|maybe|optional|low priority|nice to have)\b/.test(title)) return 2;
  return 1;
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

/**
 * How much a block matters to Nick, in words ORION can say and reason with
 * (2026-10-05): "fixed" (a real class: never moved unless he says so),
 * "high", "medium" or "low". His own words in config.ranks win, then the
 * importance he gave it, then the kind.
 */
export function rankOf(block, { ranks = {} } = {}) {
  const title = String(block.title ?? "").toLowerCase();
  if (block.kind === "class" && block.fixed && block.source !== "orion") return "fixed";
  const mine = Object.entries(ranks ?? {}).find(([word]) => word && title.includes(word.toLowerCase()));
  if (mine) return mine[1];
  if (block.fixed) return "fixed";
  const importance = importanceOf(block);
  if (importance === 0) return "high";
  if (importance === 2) return "low";
  if (/\b(nap|wind down|sleep|bed)\b/.test(title)) return "high";
  if (["gym", "deadline", "study"].includes(block.kind)) return "high";
  if (["side_project", "meal", "other"].includes(block.kind)) return "medium";
  return "low";
}
