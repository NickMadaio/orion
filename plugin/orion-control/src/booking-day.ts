/*
 An explicit day in his words beats a default day (gate run-1101080052, rea-work-on-it-tomorrow-c): "move finish resume to tomorrow at 10am,
 45 min" answered a pending brief and was booked TODAY, 45 min "each". A booking path that only knows today and tomorrow asks here first:
 a weekday name or a date ("friday", "on the 4th", "next week") is a day it cannot honour itself, so it hands the request on to the path
 that can instead of putting it on today. Pure.
*/
// Full names are days wherever they stand. Short forms that are also ordinary words (sun, sat, wed, mon) need a day context: a word like
// on / this / next / by before them, a clock time after them ("gym sat 9am"), or nothing else in the message ("sun").
const FULL_DAY = /\b(?:monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;
const SAFE_SHORT = /\b(?:tues?|thu|thur|thurs|fri)\b/i;
const CONTEXT_SHORT = /(?:\b(?:on|this|next|by|until|till|before|for|every|last|from|each)\s+(?:coming\s+)?)(?<d>mon|weds?|sat|sun)\b|\b(?<t>mon|weds?|sat|sun)(?=\s+\d{1,2}(?::\d{2})?\s*(?:am|pm)?\b)|^\s*(?<s>mon|weds?|sat|sun)\s*[.!]?\s*$/i;
const DATE = /\b(?:on\s+the\s+)?\d{1,2}(?:st|nd|rd|th)\b|\b(?:next|this coming)\s+(?:week|month|weekend)\b|\b(?:in|after)\s+(?:\d+|a|two|three|four|five)\s+days?\b|\bthe\s+(?:day after tomorrow|weekend)\b/i;

/** A day other than today or tomorrow that his words name ("friday", "on the 4th", "next week"), else undefined. */
export function otherDayNamed(text: string): string | undefined {
  const m = text.match(DATE) ?? text.match(FULL_DAY) ?? text.match(SAFE_SHORT);
  if (m) return m[0].trim().toLowerCase();
  const c = CONTEXT_SHORT.exec(text);
  return (c?.groups?.d ?? c?.groups?.t ?? c?.groups?.s)?.toLowerCase();
}
