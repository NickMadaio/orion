// How ORION reaches Nick when he starts the conversation himself (2026-10-07).
// Nick: away from the Mac → his phone; at the Mac → the bubble always, and ORION
// speaks it only when he is home OR has headphones in (spec 3.4.4, 2026-10-16).
// Pure: facts in, a decision out.

import { bypassesQuiet } from "./quiet.mjs";

export const IDLE_AWAY_SECONDS = 5 * 60;

/** Aloud only when home is known to be true, or his headphones are on. Unknown home on speakers means bubble only. */
export const speakOnMac = ({ atHome = null, headphones = null, lateAwake = false } = {}) => !lateAwake && (atHome === true || headphones === true);

/**
 * @param facts { idleSeconds, locked, displayAsleep, out, headphones, quiet, atHome, speakOnMac }
 *   speakOnMac: awareness-derived (see speakOnMac above); when given it alone decides speech
 *   out: legacy fallback when no awareness is given: a class or a fixed plan is on right now
 *   quiet: quiet hours (asleep) — nothing aloud, phone only if urgent
 * @returns { channel: "phone"|"mac-bubble"|"mac-voice"|"hold", reason }
 */
export function chooseChannel(facts, { urgent = false, urgentKind = null } = {}) {
  if (!facts || typeof facts !== "object") throw new TypeError("facts required");
  const away = facts.locked || facts.displayAsleep || !(Number(facts.idleSeconds) < IDLE_AWAY_SECONDS);
  // 2026-10-16: only a reminder he set or a class he is about to miss bypasses quiet hours; a bare urgent flag no longer does.
  if (facts.quiet && !bypassesQuiet({ urgentKind })) return { channel: "hold", reason: "quiet hours — it waits until morning" };
  if (away) return { channel: "phone", reason: facts.locked ? "the Mac is locked" : `no activity on the Mac for ${Math.round((facts.idleSeconds ?? 0) / 60)} min` };
  // Awake at the Mac inside his sleep window: never aloud (someone may be asleep).
  if (facts.lateAwake) return { channel: "mac-bubble", reason: "he's up inside his sleep window - no sound" };
  if (typeof facts.speakOnMac === "boolean") {
    return facts.speakOnMac
      ? { channel: "mac-voice", reason: facts.atHome === true ? "he's at the Mac at home" : "he's at the Mac with headphones in" }
      : { channel: "mac-bubble", reason: "he's at the Mac, but home is not known and no headphones - bubble only" };
  }
  if (facts.headphones) return { channel: "mac-voice", reason: "he's at the Mac with headphones in" };
  if (facts.out) return { channel: "mac-bubble", reason: "he's at the Mac but out (class or a plan) — no sound" };
  return { channel: "mac-voice", reason: "he's at the Mac at home" };
}

/** A sensible speaking volume (0–100): bring a muted or near-silent Mac up, a loud one down. */
export function speakingVolume(current, { muted = false, headphones = false } = {}) {
  const target = headphones ? 35 : 45;
  if (muted || current < 20) return target;
  if (current > 70) return 55;
  return current;
}

/** Don't nag: the same text within `windowMs`, or more than `perHour` messages in an hour, is held. */
export function allowed(text, history, { now = Date.now(), windowMs = 2 * 3600_000, perHour = 6 } = {}) {
  const norm = (t) => String(t).toLowerCase().replace(/\W+/g, " ").trim();
  // Held and failed attempts never reached him, so they neither block a retry
  // as a "repeat" nor use up the hourly allowance (2026-10-16 audit, finding 6).
  const failed = new Set(history.filter((h) => h.status === "failed").map((h) => h.id));
  const reached = history.filter((h) => h.channel !== "hold" && h.status !== "failed" && !failed.has(h.id));
  if (reached.some((h) => norm(h.text) === norm(text) && now - Date.parse(h.at) < windowMs)) return { ok: false, duplicate: true, reason: "already told him that recently" };
  if (reached.filter((h) => now - Date.parse(h.at) < 3600_000).length >= perHour) return { ok: false, reason: `already reached him ${perHour} times this hour` };
  return { ok: true };
}

/** Outreach that counts toward the daily ceiling (3.4.3): the loop's own, never a reminder he set or a class rung. */
export const COUNTED_WHY = /^(proactive|plan|curiosity):/;

/** How many counted messages reached him on `date` (a local YYYY-MM-DD). Held, dropped and failed rows do not count. */
export function countedToday(history, date, localDate) {
  return history.filter((h) => COUNTED_WHY.test(String(h.why ?? "")) && h.channel !== "hold" && h.status !== "failed" && h.status !== "dropped"
    && localDate(new Date(h.at)) === date).length;
}
