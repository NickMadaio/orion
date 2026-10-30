// The two things the Mac app answers WITHOUT calling the gateway (AppState.send): resume phrases
// (AdaptiveEndpointModel.isResumeRequest) and clock questions (MobileCore/QuickAnswer). A gate test of
// "what time is it" never reaches ORION in the real app, so the driver reports it instead of asking.
import { trimH } from "./text.mjs";

const RESUME = new Set(["continue", "keep going", "go on", "go ahead", "please continue", "what were you saying", "finish that",
  "finish what you were saying", "keep talking", "continue what you were saying"]);
export function isResumeRequest(text) {
  const n = text.toLowerCase().replace(/^[\s\u0085]+|[\s\u0085]+$/g, "").replace(/^[.?!]+|[.?!]+$/g, "");
  return RESUME.has(n);
}

const TIME_Q = new Set(["what time is it", "what time is it now", "what time is it right now", "whats the time", "what is the time",
  "whats the time now", "time", "the time", "what's the time", "do you know what time it is", "tell me the time",
  "what time is it currently", "orion what time is it", "hey orion what time is it"]);
const DAY_Q = new Set(["what day is it", "what day is it today", "whats today", "what is today", "what day is today"]);
const DATE_Q = new Set(["whats the date", "what is the date", "whats todays date", "what is todays date", "whats the date today",
  "what is the date today", "todays date"]);
const FILLERS = new Set(["and", "so", "ok", "okay", "hey", "orion", "um", "uh", "well", "yo", "quick", "question", "then", "now", "sorry", "wait", "also", "but"]);

function normalise(text) {
  return trimH(text.toLowerCase().replaceAll("’", "'").replaceAll("'", "")
    .replace(/[^\p{L}\p{M} \t   -   　]/gu, "")
    .split(" ").filter(Boolean).join(" "));
}
function stripLeadIn(text) {
  const words = text.split(" ").filter(Boolean);
  while (words.length > 2 && FILLERS.has(words[0])) words.shift();
  return words.join(" ");
}

/** The reply the app would give from the clock, or null when the message goes to ORION. */
export function quickAnswer(text, now = new Date(), timeZone = undefined) {
  const t = stripLeadIn(normalise(text));
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(now).map((p) => [p.type, p.value]));
  const time = `${parts.hour}:${parts.minute} ${String(parts.dayPeriod).toUpperCase()}`;
  const day = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "long" }).format(now);
  const date = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "long" }).format(now);
  if (TIME_Q.has(t)) return `It's ${time}.`;
  if (DAY_Q.has(t) || DATE_Q.has(t)) return `It's ${day}, ${date}.`;
  return null;
}
