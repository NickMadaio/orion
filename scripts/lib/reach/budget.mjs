// Who may reach Nick, and how often (2026-10-19 audit). The old 20-a-day ceiling counted every proactive message by
// arrival, so repeated ladder rungs for low-value blocks used it up by 14:30 and the gym (a must) was never nudged.
//
// Tiers:
//   protected  a reminder he set, a class/leave rung, a must block (gym), the day review, the morning brief: never blocked
//   low        a plan ladder for a block that is not a must: a small budget, and every rung of one block counts once
//   blank      a "what are you up to?" / fill-blank ask: its own small budget
//   normal     the rest of ORION's own lines (bedtime, due tomorrow, ...): only the backstop ceiling
// The ceiling stays as a spam backstop for everything that is not protected.
// A message dropped here is recorded with a cooldown and given up after a few tries: never re-tried every tick.
// Pure: history rows in, a verdict out.

export const COUNTED_WHY = /^(proactive|plan|curiosity):/;
export const BLANK_TYPES = Object.freeze(["home-gap", "away-gap", "unknown-place", "save-place", "fill-blank", "blank"]);
export const TIERS = Object.freeze(["protected", "low", "blank", "normal"]);

const MIN = 60_000;
const why = (r) => String(r?.why ?? "");

/** The tier of one message. An explicit tier (a caller that knows the block's rank) wins, but cannot lower a protected case. */
/** `--tier protected` is not trusted from any caller: only these internal ones may ask for it (a reminder, a class/leave line, a must block's ladder, the review). */
export const mayBeProtected = ({ kind = null, why: reason = "" } = {}) =>
  kind === "reminder" || (kind === "checkin" && /^plan:/.test(String(reason))) || /^curiosity: review-/.test(String(reason));

export function tierOf({ why: reason = "", urgentKind = null, bypass = false, tier = null, askType = null, kind = null } = {}) {
  const w = String(reason ?? "");
  if (bypass || urgentKind) return "protected";
  if (/^curiosity: review-/.test(w) || /^morning:/.test(w)) return "protected";
  if (TIERS.includes(tier) && (tier !== "protected" || mayBeProtected({ kind, why: w }))) return tier;
  if (/^plan:/.test(w)) return "low";
  if (/^curiosity:/.test(w)) return askType && !BLANK_TYPES.includes(askType) ? "low" : "blank";
  return "normal";
}

/** The tier a logged row had (rows written before tiers existed are classified from their why and ask). */
export const rowTier = (r) => (TIERS.includes(r?.tier) ? r.tier : tierOf({ why: why(r), urgentKind: r?.urgentKind ?? null, askType: r?.ask?.type ?? null }));

const reachedToday = (history, date, localDate) => {
  const seen = new Set();   // a row is logged twice when the app is down and it falls back to the phone: one message
  return history.filter((h) => !h.id || (!seen.has(h.id) && seen.add(h.id)))
    .filter((h) => COUNTED_WHY.test(why(h)) && h.channel !== "hold" && h.status !== "failed" && h.status !== "dropped" && localDate(new Date(h.at)) === date);
};

/** What a row is "about", so the rungs of one block count once: the block's title, else its why. */
const subject = (r) => String(r?.ask?.title ?? why(r)).toLowerCase();

/**
 * May this message go? Never blocks a protected one.
 * @returns {{ ok: true } | { ok: false, reason: "ceiling"|"budget"|"blank-budget", detail: string }}
 */
export function budgetVerdict({ history, date, localDate, why: reason, tier, askTitle = null, limits }) {
  if (tier === "protected" || !COUNTED_WHY.test(String(reason ?? ""))) return { ok: true };
  const today = reachedToday(history, date, localDate).filter((r) => rowTier(r) !== "protected");
  // a low-value block counts once toward the backstop however many rungs it sent (6 blocks x 5 rungs is 6, not 30)
  const lowBlocks = new Set(today.filter((r) => rowTier(r) === "low").map(subject));
  const counted = today.filter((r) => rowTier(r) !== "low").length + lowBlocks.size;
  if (counted >= limits.ceiling) return { ok: false, reason: "ceiling", detail: `already reached him ${limits.ceiling} times today` };
  if (tier === "low") {
    const subjects = new Set(today.filter((r) => rowTier(r) === "low").map(subject));
    const mine = String(askTitle ?? reason).toLowerCase();
    if (!subjects.has(mine) && subjects.size >= limits.lowValue) return { ok: false, reason: "budget", detail: `low-value nudges are limited to ${limits.lowValue} blocks a day` };
  }
  if (tier === "blank" && today.filter((r) => rowTier(r) === "blank").length >= limits.blank) {
    return { ok: false, reason: "blank-budget", detail: `blank asks are limited to ${limits.blank} a day` };
  }
  return { ok: true };
}

/**
 * Has this same message already been dropped today, and is it too soon (or too often) to try again?
 * The cooldown doubles with each drop; after `maxDrops` it is given up for the day.
 * @returns {{ skip: false, drops: number } | { skip: true, why: "cooldown"|"gave-up", until: number|null, drops: number }}
 */
export function dropGuard({ history, date, localDate, why: reason, now, cooldownMinutes = 30, maxDrops = 3 }) {
  const drops = history.filter((h) => h.status === "dropped" && why(h) === reason && h.reason !== "expired" && localDate(new Date(h.at)) === date);
  if (drops.length >= maxDrops) return { skip: true, why: "gave-up", until: null, drops: drops.length };
  const last = Math.max(0, ...drops.map((h) => Date.parse(h.at)).filter(Number.isFinite));
  const until = last + cooldownMinutes * 2 ** Math.max(0, drops.length - 1) * MIN;
  return drops.length && now < until ? { skip: true, why: "cooldown", until, drops: drops.length } : { skip: false, drops: drops.length };
}
