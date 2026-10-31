// The escalation ladder for a planned block he has not started (2026-10-30). Pure: facts in, a decision or a sentence out.
//
// R2 evidence: the old five-step script ended "I'll stop pinging about Gym - I've moved what I could." with a gave-up slip
// (gym 10-16, 10-20, 10-21, 10-23); both 10-27 loops expired at level 0 with nothing said; "I'm meal prepping" was answered
// "What time or how long do you mean?"; and 10-18 said "It's been 1039 min. Gym, now." Here:
//
//   L0   at the mismatch (5 min in)  gentle: "Time to start: Gym."            (firm: with his own record for that kind)
//   L1   +10                         firmer, specific, and a smaller version: "Just 30 min then."
//   L2   +20                         time-sensitive phone push, and the Mac aloud when he is home or has headphones in
//   L3   +40                         firm: "No. You've been avoiding this for an hour. Get up." and, only with the grant, restriction
//   END  +60, or the block is over   the day is re-weighed (orion-reschedule displace) and he is told what happens now; when the
//                                    replan could not place it, a question. A loop never ends without this message.
//
// A legitimate reason (eating, meal prep, a call) is a grace of 20-30 min and a comeback ("Okay, you ate. Now we're starting."),
// not a dead end. The caps are a safety net, never the schedule: 4 rungs per block in any hour, 25 a day; the closing message
// is never capped. The texts keep the shapes the plugin's reply reader parses (plugin/orion-control/src/outreach-reply.ts).

export const GAPS = Object.freeze([10, 10, 20, 20]);      // minutes after L0, L1, L2, L3
export const END_RUNG = 4;
export const CAPS = Object.freeze({ perBlockPerHour: 4, perDay: 25 });
export const GRACE = Object.freeze({ min: 20, max: 30, perLoop: 2 });
export const RECORD_FRESH_MS = 15 * 60_000;                // orion-proactive writes now.json every ~5 min
const RESTRICT_SAMPLE_MS = 10 * 60_000;
const MAC_FREE_KINDS = new Set(["gym", "meal", "rest", "other_place"]);

const NAMES = ["L0", "L1", "L2", "L3", "END"];
export const rungName = (rung) => NAMES[Math.min(END_RUNG, Math.max(0, rung))];
export const nextGap = (rung) => GAPS[Math.min(GAPS.length - 1, Math.max(0, rung))];

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const cap = (t) => String(t).charAt(0).toUpperCase() + String(t).slice(1);
const hm = (m) => { const h = Math.floor((((m % 1440) + 1440) % 1440) / 60), mm = ((m % 60) + 60) % 60; return `${((h + 11) % 12) + 1}:${String(mm).padStart(2, "0")} ${h >= 12 ? "PM" : "AM"}`; };

/** "Just 30 min then": half the block, 30 at most, never more than is left of it, never under 10. */
export function smallerVersion(window, nowMinute) {
  const length = window ? window.end - window.start : 60;
  const half = Math.round(length / 2 / 5) * 5;
  const left = window ? window.end - nowMinute : length;
  return clamp(Math.min(30, half, left), 10, 30);
}

/** His own record for this kind, when it is bad enough to say: "Gym: 0 of the last 6 happened." */
export function avoidanceLine(patterns, kind, title) {
  const k = patterns?.byKind?.[kind];
  if (!k || !(k.planned >= 3) || !(Number(k.rate) < 0.5)) return null;
  return `${cap(title)}: ${k.happened ?? 0} of the last ${k.planned} happened.`;
}

/**
 * flexible | firm. The now record's own strictness wins when it is about this block; otherwise the same rule it uses
 * (docs/design/2026-10-30-now-record.md): 30+ min old, something of the same kind or title slipped today, or that kind
 * happening under half the time over 3+ samples. `firm` is forced by a refused excuse.
 */
export function strictnessFor({ record = null, blockId, kind, title = "", elapsed = 0, patterns = null, slips = [], firm = false }) {
  if (firm) return "firm";
  if (record?.shouldBe?.blockId === blockId && ["flexible", "firm"].includes(record.strictness)) return record.strictness;
  if (elapsed >= 30) return "firm";
  if ((slips ?? []).some((s) => (s.kind && s.kind === kind) || (s.title && title && s.title === title))) return "firm";
  return avoidanceLine(patterns, kind, title) ? "firm" : "flexible";
}

/**
 * One rung's sentence. `elapsed` is minutes since the block's own start today and is capped at the block's length, so a
 * stale count ("1039 min") cannot be said.
 */
export function rungText({ rung, title, elapsed = 0, smaller = 30, strictness = "flexible", avoidance = null, habit = null, restricted = null, blockMinutes = null }) {
  const t = String(title);
  const n = Math.max(0, Math.round(blockMinutes ? Math.min(elapsed, blockMinutes) : elapsed));
  switch (rung) {
    case 0: {
      const extra = strictness === "firm" && avoidance ? ` ${avoidance} Not today.` : habit ? ` ${habit}` : "";
      return `Time to start: ${t}.${extra}`;
    }
    case 1: return strictness === "firm"
      ? `${cap(t)} — still not started. Just ${smaller} min then, and it starts now.`
      : `${cap(t)} — still not started. Just ${smaller} min then; get going and see how you feel.`;
    case 2: return `It's been ${n} min. ${cap(t)}, now. Phone down, ${smaller} min still counts.`;
    default: {
      const lock = restricted === "lock" ? " I've locked the Mac until you go." : restricted === "front" ? " I've put your work back in front of you." : "";
      return n >= 60
        ? `You've been avoiding ${t} for ${n} min. No. That's an hour. Get up.${lock}`
        : `You've been avoiding ${t} for ${n} min. No. Get up.${lock}`;
    }
  }
}

/** What Mac voice says at L2: short, distinct from the phone text (orion-reach drops an identical text as a repeat). */
export const voiceText = ({ title, smaller = 30 }) => `Nick. ${cap(title)}. Now. ${smaller} minutes still counts.`;

/** After a grace: "Time to start: Gym. Okay, you ate. Now we're starting." */
export const comebackText = ({ title, returning }) => `Time to start: ${title}. Okay, ${returning || "break's over"}. Now we're starting.`;

/**
 * The closing message, after the day was re-weighed. replan: { kind: "moved", start, end } (minutes), "no-room" or "failed".
 * It always says what happens now; "moved" is a tell, the other two are the question.
 */
export function endText({ title, start, smaller = 30, replan = { kind: "failed" } }) {
  const t = cap(title);
  const when = Number.isFinite(start) ? ` at ${hm(start)}` : "";
  if (replan?.kind === "moved") return `${t} didn't happen${when}. I've moved it to ${hm(replan.start)}–${hm(replan.end)}; that's the plan now. If today's off, say skip.`;
  if (replan?.kind === "no-room") return `${t} didn't happen${when}, and there's no room left today for all of it. Want ${smaller} min tonight, or first thing tomorrow?`;
  return `${t} didn't happen${when}. Should I move it to later today, or is today off?`;
}

/** orion-reschedule displace's own output, read for the closing message. */
export function replanFrom({ status, stdout = "" }, title) {
  const out = String(stdout);
  const esc = String(title).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const placed = out.match(new RegExp(`re-entered ${esc}: (\\d{2}):(\\d{2})–(\\d{2}):(\\d{2})`, "i"));
  if (status === 0 && placed) return { kind: "moved", start: Number(placed[1]) * 60 + Number(placed[2]), end: Number(placed[3]) * 60 + Number(placed[4]) };
  if (status === 0 && new RegExp(`${esc} has no room today`, "i").test(out)) return { kind: "no-room" };
  return { kind: "failed" };
}

const REASONS = [
  [/\bmeal ?prep\w*|\bprepping\b|\bcook(?:ing)?\b/i, "meal prep's done"],
  [/\b(?:eat|eating|ate|meal|lunch|dinner|breakfast|food|hungry|starving|snack)\b/i, "you ate"],
  [/\b(?:on a call|call|meeting|zoom|facetime)\b/i, "the call's done"],
  [/\bshower(?:ing)?\b/i, "you showered"],
  [/\b(?:bathroom|toilet|loo)\b/i, "you're back"],
  [/\blaundry\b/i, "laundry's sorted"],
];
const AVOIDING = /\b(?:later|in a bit|not now|tomorrow|one more|five more|5 more|don'?t feel like|can'?t be bothered|meh)\b/i;

/** A legitimate pause: { minutes (20-30), returning } ; avoidance or no reason is null (the ladder goes on). */
export function graceFor(text, minutes) {
  const t = String(text ?? "");
  if (!t.trim() || AVOIDING.test(t)) return null;
  const hit = REASONS.find(([re]) => re.test(t));
  return hit ? { minutes: clamp(Number(minutes) || GRACE.min, GRACE.min, GRACE.max), returning: hit[1] } : null;
}

/**
 * The safety cap. `sent`: every ladder message today [{ blockId, at }]. The closing message (END) is never capped: a loop
 * that cannot close is the failure this module exists to stop.
 */
export function capVerdict({ sent = [], blockId, nowMs, rung }) {
  if (rung >= END_RUNG) return { ok: true };
  if (sent.length >= CAPS.perDay) return { ok: false, reason: "day", detail: `${CAPS.perDay} ladder messages today` };
  const recent = sent.filter((s) => s.blockId === blockId && nowMs - Date.parse(s.at) < 3600_000).sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (recent.length >= CAPS.perBlockPerHour) return { ok: false, reason: "block-hour", retryAt: Date.parse(recent[0].at) + 3600_000 };
  return { ok: true };
}

/**
 * Restriction at the firm L3, only when Nick granted it (life-config escalation.restrict) AND the Mac app's own consent switch
 * says so on a fresh sample (focus-activity.json enforcementAllowed, the switch orion-ontask-watch already obeys).
 * A block away from the Mac (the gym) locks the screen; a Mac block brings its work app to the front.
 */
export function restrictionFor({ grant = false, activity = null, kind, nowMs, strictness }) {
  if (grant !== true || strictness !== "firm" || activity?.enforcementAllowed !== true) return null;
  const at = Date.parse(activity.at);
  if (!Number.isFinite(at) || nowMs - at > RESTRICT_SAMPLE_MS) return null;
  if (MAC_FREE_KINDS.has(kind)) return { step: "lock" };
  return activity.workApp ? { step: "front", app: activity.workApp } : null;
}

/**
 * What the now record says about this block. go: it is the block he should be on and nothing shows he started; wait: the
 * record says something else matters now (a class, sleep, he is on it); window: no fresh record, the block's window decides.
 */
export function recordSays(record, { blockId, nowMs }) {
  const at = Date.parse(record?.computedAt);
  if (!record || !Number.isFinite(at) || nowMs - at > RECORD_FRESH_MS) return { verdict: "window" };
  if (record.shouldBe?.blockId !== blockId) return { verdict: "wait", why: `now: ${record.shouldBe?.kind ?? "unknown"}` };
  if (!record.mismatch || !["not-started", "missed", "off-plan"].includes(record.mismatch.kind)) return { verdict: "wait", why: "no mismatch" };
  return { verdict: "go", minutes: record.mismatch.minutes, strictness: record.strictness };
}
