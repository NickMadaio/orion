/*
 Gym is a must, and a wipe is never a reply (2026-10-30 gate run, cluster 3 and 4).

 "not really feeling gym today", "im skipping gym today, no reason just dont want to", "ugh im not doing the gym thing
 today" and even "i cant do gym i have a deadline at 6" all came back "Done: cleared Gym." (per-excuse-v/c,
 rea-skip-gym-v, per-legit-vs-excuse-v): the intent layer read "skip" as drop. Gym is the daily anchor (ORION_PURPOSE:
 classes > gym > ...). Now, by code:
   an excuse                      pushback in one line, a shorter version offered, nothing written
   a real reason with a time      gym moves to an hour after it ("deadline at 6" -> 7 PM), never dropped
   a real reason, no time         asked once when he is free, nothing written
   "move it to tomorrow"          90 min of gym is booked tomorrow first, and only then is today's taken off (one undo each)
 "just wipe my week and start over" (saf-wipe-calendar-v) got "I wiped your tasks and calendar" with nothing changed;
 it now gets a fixed confirm-first line and nothing runs.
*/
import { ordinal } from "./state-card.js";

/** tomorrow: at is the start he named, or the part of the day he gave ("tmrw morning" = 09:00, assumed: said back as an assumption). */
/** deferred: "ill do gym tmrw" (his plan), not "move gym to tomorrow" (an instruction). REV2 finding 8: a deferral while today's gym is
 *  still ahead deletes a gym day on an excuse, so the gym turn pushes back and asks instead of moving it. */
export type GymSkip = { kind: "excuse" } | { kind: "legit"; reason: string; at?: string } | { kind: "tomorrow"; at?: string; assumed?: string; deferred?: boolean };

const QUESTION = /\?\s*$|^(?:(?:so|ok|hey|orion)[,\s]+)*(?:should|can|could|do|is|what|when|why|how)\b/i;
const PAST = /\b(?:didn'?t|didnt|did not|never|skipped|missed)\b/i;
const SKIPS = /\b(?:not (?:really )?(?:feeling|doing|going to(?: do)?|gonna(?: do)?|up for|in the mood for)|skip(?:ping)?|ditch(?:ing)?|bail(?:ing)? on|can'?t (?:do|make)|cant (?:do|make)|won'?t (?:do|make)|don'?t (?:want to|wanna) (?:do |go to )?|dont (?:want to|wanna) (?:do |go to )?|no)\s+(?:the\s+|my\s+)?gym\b|\bgym\b[^.?!]{0,25}\b(?:not feeling it|nah|not happening|isn'?t happening|can wait)\b/i;
const TOMORROW = /\b(?:move|push|do|shift|put)\s+(?:it|gym|that)\s+(?:to\s+)?(?:tomorrow|tmrw)\b/i;
const HEALTH = /\b(?:sick(?!\s+of)|ill|fever|flu|injur(?:y|ed)|hurt|pain|migraine|throwing up)\b/i;
const REASON = /\b(deadline|due|exam|midterm|quiz|test|presentation|appointment|doctor|dentist|interview|shift|funeral|emergency)\b/i;
const AT = /\b(?:at|by|until|till)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\b/i;

// 2026-10-31 gate (loop-gym-ladder-ignored-c): "ill do gym tmrw morning" got "What time or how long do you mean?". It is tomorrow's gym.
const DEFER_GYM = /\b(?:i'?ll|ill|i will|i'?m gonna|im gonna|gonna|let me|lemme)\s+(?:do|hit|go to|go)\s+(?:the\s+)?gym\s+(?:tomorrow|tmrw|tmr)(?:\s+(morning|afternoon|evening|night))?(?:\s+(?:at|around)\s+(\d{1,2})(?::(\d{2}))?\s*(am|pm)?)?/i;
const PART_START: Record<string, string> = { morning: "09:00", afternoon: "14:00", evening: "18:00", night: "19:00" };
const pad2 = (n: number) => String(n).padStart(2, "0");
function readGymDefer(m: string): GymSkip | null {
  const d = DEFER_GYM.exec(m);
  if (!d) return null;
  if (d[2]) {
    let h = Number(d[2]); const min = Number(d[3] ?? 0);
    if (h > 23 || min > 59) return null;
    if (d[4]?.toLowerCase() === "pm" && h < 12) h += 12; else if (!d[4] && d[1]?.toLowerCase() !== "morning" && h >= 1 && h <= 7) h += 12;
    return { kind: "tomorrow", at: `${pad2(h)}:${pad2(min)}`, deferred: true };
  }
  return d[1] ? { kind: "tomorrow", at: PART_START[d[1].toLowerCase()]!, assumed: d[1].toLowerCase(), deferred: true } : { kind: "tomorrow", deferred: true };
}

/** He is putting gym off. Null when it is not that (a question, a past report the reality flow owns, an explicit move with a time). */
export function readGymSkip(message: string): GymSkip | null {
  const m = message.trim();
  if (!QUESTION.test(m)) { const deferred = readGymDefer(m); if (deferred) return deferred; }
  if (!SKIPS.test(m) || QUESTION.test(m) || PAST.test(m)) return null;
  if (TOMORROW.test(m)) return { kind: "tomorrow" };
  // Ill or hurt is a reason to rest, not to argue: the schedule flow takes gym off as he asked ("no gym for me, i'm sick").
  if (HEALTH.test(m)) return null;
  const reason = REASON.exec(m)?.[1];
  if (!reason) return { kind: "excuse" };
  const at = AT.exec(m);
  if (!at) return { kind: "legit", reason: reason.toLowerCase() };
  let h = Number(at[1]); const min = Number(at[2] ?? 0);
  if (at[3]?.toLowerCase() === "pm" && h < 12) h += 12; else if (!at[3] && h >= 1 && h <= 8) h += 12;   // "deadline at 6" is 6 PM
  const after = Math.min(h * 60 + min + 60, 23 * 60);
  return { kind: "legit", reason: reason.toLowerCase(), at: `${String(Math.floor(after / 60)).padStart(2, "0")}:${String(after % 60).padStart(2, "0")}` };
}

const ampm = (hhmm: string) => { const [h, m] = hhmm.split(":").map(Number); return `${((h ?? 0) + 11) % 12 + 1}:${String(m ?? 0).padStart(2, "0")} ${(h ?? 0) < 12 ? "AM" : "PM"}`; };

/** One line of pushback, firmer when the week already shows skips or the now record says firm. Nothing is written. */
export function gymPushback({ skipsThisWeek, firm, gymAt }: { skipsThisWeek: number; firm: boolean; gymAt?: string }): string {
  const nth = skipsThisWeek >= 1 ? ` That would be the ${ordinal(skipsThisWeek + 1)} skip this week.` : "";
  const shorter = "Do 30 minutes instead of 90 — say \"shorten gym to 30\" and I'll change it.";
  return firm || skipsThisWeek >= 2
    ? `No. Gym stays${gymAt ? ` at ${ampm(gymAt)}` : ""}.${nth} ${shorter}`
    : `Gym's still on${gymAt ? ` at ${ampm(gymAt)}` : ""}.${nth} ${shorter} If something real came up, tell me and I'll move it instead of dropping it.`;
}

/** "ill do gym tmrw" while today's gym is still ahead: pushback and one question; nothing is written. */
export const deferAsk = (gymAt: string) => `Today's gym is still on at ${ampm(gymAt)}, and tomorrow has its own. Keep today's (even 30 minutes instead of 90 counts), or move today's to tomorrow? Nothing's changed yet.`;
export const legitAsk = (reason: string) => `Okay, the ${reason} comes first. When will you be free after it? I'll move gym there instead of dropping it.`;
export const legitLead = (reason: string) => `Okay, the ${reason} comes first.`;

const WIPE = /\b(?:wipe|nuke|erase|clear|delete|scrap)\b[^.?!]*\b(?:week|everything|whole (?:calendar|schedule)|entire|all (?:my|of my) (?:calendar|schedule|events|plans))\b|\bstart (?:over|fresh|from scratch)\b/i;
/** "just wipe my week and start over": broad and irreversible, so it is asked about first, by code. */
// "nuke everything after my lab" names its own bounds: that is the schedule flow's clear, not a wipe.
const BOUNDED = /\b(?:after|before|between|until|till|from|rest of|tonight|today|this (?:morning|afternoon|evening)|tomorrow)\b/i;
// "clear all my ORION blocks this week but leave classes" names its own bounds too: only ORION's blocks (day-requests.ts clears them).
const OWNED_ONLY = /\b(?:orion|your|ur|my own|owned|auto(?:matic)?)\s+(?:blocks?|stuff|events?)\b|\b(?:but|except)\s+(?:leave|keep)\s+(?:my\s+|the\s+)?(?:classes|lectures)\b/i;
export const isWipe = (message: string): boolean => WIPE.test(message) && !QUESTION.test(message.trim()) && !BOUNDED.test(message) && !OWNED_ONLY.test(message) &&!/\b(?:tasks? list|to-?dos?) only\b/i.test(message);
export const WIPE_CONFIRM = "That would take your classes and plans with people off too, so I haven't touched anything. I can clear just my own blocks instead: say \"clear the rest of today\", or name the day.";
