export const LISTS = ["messaging", "feeds", "video", "games", "browsers"];

// Words Nick or the model may use for a group. Only the group words themselves: never an app name, so "block
// youtube" can not quietly become a whole category.
export const ALIASES = {
  social: "feeds", feed: "feeds", socials: "feeds", "social-media": "feeds",
  browser: "browsers", web: "browsers", safari: "browsers", chrome: "browsers",
  videos: "video", game: "games", gaming: "games", message: "messaging", messages: "messaging", chat: "messaging",
};
export function groupName(word) {
  const w = String(word ?? "").trim().toLowerCase();
  if (LISTS.includes(w)) return w;
  return ALIASES[w] ?? null;
}

// Minutes in one group before a focus block blocks that group (and only that group).
export const FOCUS_BLOCK_MINUTES = 15;
// Browsers get the same daily cap as feeds and video.
const DAILY_CAP = { feeds: 120, video: 120, games: 90, browsers: 120 };
const CAP_WORDS = { feeds: "feeds over 2 hours today", video: "video over 2 hours today", games: "games over 1.5 hours today", browsers: "browsers over 2 hours today" };

const FOCUS_KINDS = new Set(["study", "side_project", "deadline", "other"]);

function validateUsed(usedToday) {
  for (const list of LISTS) {
    if (list === "browsers" && !(list in usedToday)) continue; // reports from before this group existed
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
  if (block !== null && typeof block !== "object")
    throw new TypeError("block must be null or an object");
  if (typeof usedToday !== "object" || usedToday === null)
    throw new TypeError("usedToday must be an object");
  if (!["none", "warn", "block"].includes(escalation))
    throw new TypeError(`escalation must be "none", "warn" or "block", got "${escalation}"`);

  validateUsed(usedToday);
  validateCurrent(current);
  usedToday = { browsers: 0, ...usedToday };

  const blocked = new Set();
  const why = {};
  const reasons = [];
  const add = (list, reason) => { blocked.add(list); why[list] ??= reason; reasons.push(reason); };

  // Rule 1: daily caps, each group on its own use
  for (const list of Object.keys(DAILY_CAP)) {
    if (usedToday[list] >= DAILY_CAP[list]) add(list, CAP_WORDS[list]);
  }
  // Feeds capped AND video >= 30 more: block video too
  if (blocked.has("feeds") && usedToday.video >= 30 && !blocked.has("video")) add("video", "video continues after feeds capped");

  // Rule 2: a focus block at escalation "block" blocks the groups actually in use, not every distracting group
  const isFocusBlock = block !== null && FOCUS_KINDS.has(block.kind);
  if (isFocusBlock && escalation === "block") {
    const blockTitle = block.title ? `'${block.title}'` : "focus block";
    for (const list of ["feeds", "video", "games", "browsers"]) {
      if (usedToday[list] >= FOCUS_BLOCK_MINUTES) add(list, `${usedToday[list]} min of ${list} during ${blockTitle}`);
    }
    if (current === "messaging" && allowMessaging === false) add("messaging", `messaging during ${blockTitle}`);
  }

  const blockList = LISTS.filter((l) => blocked.has(l));
  const keepList = LISTS.filter((l) => !blocked.has(l));
  return {
    block: blockList, keep: keepList,
    why: reasons.length > 0 ? reasons.join("; ") : "within daily limits",
    lists: blockList.map((name) => ({ name, why: why[name] })),
  };
}
