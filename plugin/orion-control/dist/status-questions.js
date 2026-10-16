/*
 Questions about what he is doing now, and drafts that invent his day. Live sweep 2026-10-16 (r7).
 q050 "what am i supposed to be working on right now": the worker invented "whatever project you set as your
 main focus". q015 "how much time do i have before my nap block ends": the front desk picked the focus-session
 status and the reply was about a focus session. q082 "should i sleep now or finish leetcode": the front desk's
 draft said "You've been coding for hours", which nothing supports. Written by Claude on 2026-10-16.
*/
/** "what am i supposed to be working on right now": the focus task, or else the block he is in. */
export const asksCurrentTask = (message) => /\bwhat\b.*\b(supposed to|should i be|am i|do i have to)\b.*\b(working on|doing)\b/i.test(message) && /\b(right now|now|currently|at the moment)\b/i.test(message);
/** A focus-session status question names the session; "my nap block" is a calendar question, whatever the front desk chose. */
export const asksFocusStatus = (message) => /\b(focus|session|pomodoro)\b/i.test(message);
// A sentence that states what he has been doing or how his day went: the front desk cannot know it. Praise and
// opinion ("You did great today!", "You were right") stay (review, 2026-10-16).
const DAY_CLAIM = /\byou(?:'ve| have) been (?!great|amazing|awesome|so\b|really|doing (?:great|well|amazing))|\byou(?:'ve| have) (?:just |already )?(?:worked|studied|coded|slept|done|had)\b|\byou (?:worked|studied|coded|slept)\b|\b(?:all day|for hours|so far today)\b/i;
/** A front-desk draft without its claims about his day; "" when nothing is left to say. */
export function withoutDayClaims(draft) {
    const parts = String(draft ?? "").replace(/[’‘]/g, "'").split(/(?<=[.!?])\s+/);
    return parts.filter((s) => !DAY_CLAIM.test(s)).join(" ").trim();
}
