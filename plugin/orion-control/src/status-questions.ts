/*
 Questions about what he is doing now, and drafts that invent his day. Live sweep 2026-10-16 (r7).
 q050 "what am i supposed to be working on right now": the worker invented "whatever project you set as your
 main focus". q015 "how much time do i have before my nap block ends": the front desk picked the focus-session
 status and the reply was about a focus session. q082 "should i sleep now or finish leetcode": the front desk's
 draft said "You've been coding for hours", which nothing supports. Written by Claude on 2026-10-16.
*/

/** "what am i supposed to be working on right now": the focus task, or else the block he is in. */
export const asksCurrentTask = (message: string): boolean =>
  /\bwhat\b.*\b(supposed to|should i be|am i|do i have to)\b.*\b(working on|doing)\b/i.test(message) && /\b(right now|now|currently|at the moment)\b/i.test(message);

/** A focus-session status question names the session; "my nap block" is a calendar question, whatever the front desk chose. */
export const asksFocusStatus = (message: string): boolean => /\b(focus|session|pomodoro)\b/i.test(message);

// A sentence that states what he has been doing or how his day went: the front desk cannot know it.
const DAY_CLAIM = /\b(you'?ve|you have)\s+(been|just|already)\b|\byou\s+(worked|studied|coded|slept|did|were)\b|\b(all day|for hours|so far today|today you)\b/i;

/** A front-desk draft without its claims about his day; "" when nothing is left to say. */
export function withoutDayClaims(draft: string): string {
  const parts = String(draft ?? "").replace(/[’‘]/g, "'").split(/(?<=[.!?])\s+/);
  return parts.filter((s) => !DAY_CLAIM.test(s)).join(" ").trim();
}
