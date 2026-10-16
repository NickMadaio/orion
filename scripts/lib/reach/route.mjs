// How ORION reaches Nick when he starts the conversation himself (2026-10-07).
// Nick: away from the Mac → his phone; at the Mac but out (class, out and
// about) → the hologram with a silent bubble; at the Mac at home, or with
// headphones in → the hologram, out loud. Pure: facts in, a decision out.

import { bypassesQuiet } from "./quiet.mjs";

export const IDLE_AWAY_SECONDS = 5 * 60;

/**
 * @param facts { idleSeconds, locked, displayAsleep, out, headphones, quiet }
 *   out: a class or a fixed plan is on right now (he is not at home)
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
