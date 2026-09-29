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
  return KINDS.indexOf(block.kind);
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
