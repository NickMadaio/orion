import { strict as assert } from "node:assert";

export const LISTS = ["messaging", "feeds", "video", "games"];

const FOCUS_KINDS = new Set(["study", "side_project", "deadline", "other"]);

function validateUsed(usedToday) {
  for (const list of LISTS) {
    if (!(list in usedToday)) throw new TypeError(`missing key "${list}" in usedToday`);
    const v = usedToday[list];
    if (typeof v !== "number" || v < 0)
      throw new TypeError(`usedToday.${list} must be a non-negative number, got ${v}`);
  }
}

function validateCurrent(current) {
  if (current !== null && !LISTS.includes(current))
    throw new TypeError(`unknown list name "${current}"`);
}

export function listsToBlock({ block, usedToday, current, escalation, allowMessaging = true }) {
  assert(block === null || typeof block === "object", "block must be null or an object");
  assert(typeof usedToday === "object" && usedToday !== null, "usedToday must be an object");
  assert(
    ["none", "warn", "block"].includes(escalation),
    `escalation must be "none", "warn" or "block", got "${escalation}"`
  );

  validateUsed(usedToday);
  validateCurrent(current);

  const blocked = new Set();
  const reasons = [];

  // Rule 1: daily caps
  if (usedToday.feeds >= 120) {
    blocked.add("feeds");
    reasons.push("feeds over 2 hours today");
  }
  if (usedToday.video >= 120) {
    blocked.add("video");
    reasons.push("video over 2 hours today");
  }
  // Feeds capped AND video ≥ 30 more → block video too
  if (blocked.has("feeds") && usedToday.video >= 30) {
    blocked.add("video");
    if (!reasons.some((r) => r.includes("video"))) {
      reasons.push("video continues after feeds capped");
    }
  }
  if (usedToday.games >= 90) {
    blocked.add("games");
    reasons.push("games over 1.5 hours today");
  }

  // Rule 2: focus block with escalation "block"
  const isFocusBlock =
    block !== null && FOCUS_KINDS.has(block.kind);

  if (isFocusBlock && escalation === "block") {
    blocked.add("feeds");
    blocked.add("video");
    blocked.add("games");

    if (current === "messaging" && allowMessaging === false) {
      blocked.add("messaging");
    }

    const blockTitle = block.title ? `'${block.title}'` : "focus block";
    reasons.push(`focus block ${blockTitle} and ${escalation}`);
  }

  // Rule 3: warn/none adds nothing beyond rule 1 (already handled)

  // Build output in LISTS order, no duplicates
  const blockList = LISTS.filter((l) => blocked.has(l));
  const keepList = LISTS.filter((l) => !blocked.has(l));

  const why = reasons.length > 0 ? reasons.join("; ") : "within daily limits";

  return { block: blockList, keep: keepList, why };
}
