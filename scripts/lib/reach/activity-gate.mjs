// What he is doing decides whether a nudge goes (w19). Pure decision table + a small log of what was said, so the same
// line is not said twice in 30 minutes while nothing changed.
//
//   not gaming / watching / scrolling   -> deliver as written (an identical repeat inside 30 min is still dropped)
//   time-critical (class, reminder, protected tier, hard deadline) -> deliver, and own the activity:
//        "I know you're in Minecraft, but you need to leave for CS2100 in 10 min"
//   soft plan item while gaming/video   -> ONE gentle line that adapts the plan ("want me to push the resume to 8?"),
//        then back off for 30 min while the activity is unchanged
//   bedtime and sleep lines, morning briefs, answers to him -> never touched here
import { appendFileSync, readFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { activityKey, activityPlace, distractionOf } from "../awareness/activity.mjs";

export const REPEAT_MS = 30 * 60_000;
export const LOG = "activity-nudges.jsonl";

const ms = (t) => (t instanceof Date ? t.getTime() : Number(t));
const lcFirst = (t) => (/^[A-Z][a-z]/.test(t) ? t.charAt(0).toLowerCase() + t.slice(1) : t);

/** Lines that are not nudges at all: sleep, the brief, anything he asked for. Only `proactive:` and `plan:` lines are nudges. */
const NOT_ABOUT_ACTIVITY = /^proactive: (?:bed-|session-done-)|^(?:curiosity|replan|morning|brief)\b|sleep|bedtime|wind-?down/i;
export function isNudge({ why = null } = {}) {
  const w = String(why ?? "");
  return !NOT_ABOUT_ACTIVITY.test(w) && /^(?:proactive|plan):/.test(w);
}

/** Class, a reminder he set, a protected block or a hard deadline: must reach him whatever he is doing. */
export function isTimeCritical({ urgentKind = null, tier = null, kind = null, why = null, text = "" } = {}) {
  if (urgentKind === "class" || urgentKind === "reminder" || kind === "reminder" || kind === "leave" || kind === "deadline") return true;
  if (tier === "protected") return true;
  // tagged as a leave or deadline line by its key ("proactive: leave-930", "plan: leave-late-1020", "proactive: deadline-cs")
  if (/(?:^|[:\s-])(?:leave|deadline)(?:-|\b)/i.test(String(why ?? ""))) return true;
  return /\b(deadline|due (?:in|at|today|tonight)|time to leave|leave (?:in|by|now|soon)|head(?:ing)? out|out the door|late for|running late|submission)\b/i.test(String(text));
}

const hm = (m) => { const h = Math.floor((((m % 1440) + 1440) % 1440) / 60), mm = ((m % 60) + 60) % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };
/** Whole hour at least an hour from now: 6:20 -> 8:00 PM. */
export const pushedTo = (now) => { const d = new Date(now); const m = d.getHours() * 60 + d.getMinutes(); return hm((Math.floor(m / 60) + 2) * 60); };

/** The block's name out of a ladder line ("Time to start: Resume." / "Resume - still not started" / "It's been 20 min. Gym, now."). */
export function titleOf(text) {
  const t = String(text ?? "").trim();
  const m = t.match(/^Time to start:\s*([^.]+?)\.?(?:\s|$)/i) ?? t.match(/^([^—–\-\n]+?)\s*[—–-]\s*still not started/i) ?? t.match(/^It's been \d+ min\.\s*([^,]+?),\s*now/i);
  return m ? m[1].trim().replace(/^./, (c) => c.toLowerCase()) : null;
}

const normalize = (t) => String(t ?? "").toLowerCase().replace(/\d+/g, "#").replace(/[^a-z#]+/g, " ").trim();
export const textKey = (t) => normalize(t).slice(0, 90);

/** The one gentle line for a soft plan item while he is gaming or watching. */
export function gentleLine({ activity, text, now }) {
  const title = titleOf(text);
  const place = activityPlace(activity);
  return title ? `You're ${place} - want me to push ${title} to ${pushedTo(now)}?` : text;
}

/** I know you're in Minecraft, but you need to leave for CS2100 in 10 min. */
export function acknowledged({ activity, text }) {
  const place = activityPlace(activity);
  if (!place || new RegExp(`\\b${String(activity.game?.name ?? activity.domain ?? activity.app?.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(text)) return text;
  const body = lcFirst(String(text).trim());
  return `I know you're ${place}, but ${/^(?:you\b|leave\b|go\b|get\b|time to\b|it's time\b|head\b|out the door\b)/i.test(body) ? body : `this one matters: ${body}`}`;
}

const readLines = (dir) => { try { return readFileSync(join(dir, LOG), "utf8").split("\n").flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } }); } catch { return []; } };
/** Nudges said inside the repeat window, newest last. */
export function recentNudges(dir, now) {
  const t = ms(now);
  return readLines(dir).filter((r) => { const at = Date.parse(r.at); return Number.isFinite(at) && t - at <= REPEAT_MS && at <= t + 60_000; });
}
/** Remember a nudge that went. `text` must be the ORIGINAL text, the one activityVerdict compares (never the rewritten line). */
export function recordNudge(dir, { activity, text, now, kind = null, why = null, urgentKind = null, tier = null }) {
  // Only an actual nudge counts toward the repeat rule: not a reply, the brief, a sleep line or a time-critical one (those never back off).
  if (!isNudge({ why }) || isTimeCritical({ urgentKind, tier, kind, why, text })) return;
  try {
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, LOG), `${JSON.stringify({ at: new Date(ms(now)).toISOString(), key: activityKey(activity), text: textKey(text), kind })}\n`);
  } catch { /* the nudge still went */ }
}

/**
 * @param activity the fresh activity.json (or null: unknown, nothing is held back)
 * @param recent   recentNudges(dir, now)
 * @returns {{ action: "deliver"|"hold", reason: string, text?: string, drop?: boolean, heldFor?: "activity" }}
 */
export function activityVerdict({ activity, recent = [], msg = {}, now = Date.now() }) {
  if (!activity) return { action: "deliver", reason: "no fresh activity" };
  const kind = distractionOf(activity);
  if (NOT_ABOUT_ACTIVITY.test(String(msg.why ?? ""))) return { action: "deliver", reason: "sleep, the brief and answers are not about what he is doing" };
  const critical = isTimeCritical(msg);
  const key = activityKey(activity);
  const sameKey = (r) => r.key === key;
  if (critical) {
    return kind ? { action: "deliver", reason: `time-critical while ${kind}: said plainly, owning what he is doing`, text: acknowledged({ activity, text: msg.text ?? "" }) }
      : { action: "deliver", reason: "time-critical" };
  }
  if (!isNudge(msg)) return { action: "deliver", reason: "not a nudge" };
  const t = textKey(msg.text);
  if (recent.some((r) => sameKey(r) && r.text === t)) return { action: "hold", heldFor: "activity", drop: true, reason: "the same nudge went within 30 min and what he is doing has not changed" };
  if (!kind) return { action: "deliver", reason: "nothing in the way" };
  if (recent.some(sameKey)) return { action: "hold", heldFor: "activity", drop: true, reason: `he is ${kind === "game" ? "gaming" : kind === "video" ? "watching video" : "on social media"} and one gentle line already went: backing off` };
  return { action: "deliver", reason: `one gentle line while ${kind}`, text: gentleLine({ activity, text: msg.text, now }) };
}
