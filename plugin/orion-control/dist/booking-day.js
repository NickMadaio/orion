/*
 An explicit day in his words beats a default day (gate run-1101080052, rea-work-on-it-tomorrow-c): "move finish resume to tomorrow at 10am,
 45 min" answered a pending brief and was booked TODAY, 45 min "each". A booking path that only knows today and tomorrow asks here first:
 a weekday name or a date ("friday", "on the 4th", "next week") is a day it cannot honour itself, so it hands the request on to the path
 that can instead of putting it on today. Pure.
*/
const WEEKDAY = /\b(?:mon(?:day)?|tue(?:s|sday)?|wed(?:s|nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?)\b/i;
const DATE = /\b(?:on\s+the\s+)?\d{1,2}(?:st|nd|rd|th)\b|\b(?:next|this coming)\s+(?:week|month|weekend)\b|\b(?:in|after)\s+(?:\d+|a|two|three|four|five)\s+days?\b|\bthe\s+(?:day after tomorrow|weekend)\b/i;
/** A day other than today or tomorrow that his words name ("friday", "on the 4th", "next week"), else undefined. */
export function otherDayNamed(text) {
    const m = text.match(DATE) ?? text.match(WEEKDAY);
    return m?.[0].trim().toLowerCase();
}
