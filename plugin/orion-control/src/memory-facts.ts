/*
 Facts Nick tells ORION, and questions about them (live sweep 2026-10-15, memory-facts).

 "remember my wifi password is on the sticky note…", "my lab partner for ds lab is priya" and "note that my
 car insurance renews…" were answered by the front desk's draft ("I've noted that", no tool call), sent to
 the calendar flow, turned into an alarm, or saved to the ORION repair queue (the only learn example the
 worker had). Recall questions got "I can look it up if you'd like", and a course policy found by search
 was read back as "You mentioned…". A fact goes to orion-brain learn in his own "Nick" note (its learned
 lines survive a re-seed); a recall question searches the brain before any reply.
 (Written by Claude on 2026-10-16.)
*/

// "remember …", "note that …", "save that …", "… don't let me forget that": he is telling ORION something.
// "remember to …" / "don't let me forget to …" ask for a reminder, not a fact.
const TELLS = /^(?:(?:hey|ok(?:ay)?|so|also|and|btw|orion)[,\s]+)*(?:remember|note|jot down|save|keep in mind)\b(?!\s+to\b)|\b(?:remember|note|save|keep in mind) (?:that|this)\b|\bdon'?t let me forget (?:that|this|it)\s*[.!]*$/i;
// "my lab partner for ds lab is priya", "my wifi password is on the sticky note": a fact about his life.
// Not a state ("my wifi is down") or a time ("my meeting is at 3pm"), which belong to other jobs.
const MY_FACT = /^(?:(?:ok(?:ay)?|so|also|and|btw|fyi)[,\s]+)*my\s+(?:\w+\s+){0,6}?(?:is|are|'s)\s+(?!(?:down|broken|dead|not|so|too|really|kinda|being|getting|running|acting|killing|stuck|late|over|at\s+\d|in\s+\d)\b)\S/i;
// "im allergic to peanuts", "i'm vegetarian": a standing fact about him.
const STANDING = /^(?:(?:ok(?:ay)?|so|also|btw|fyi)[,\s]+)*i'?m\s+(?:allergic|lactose|vegetarian|vegan|left-handed|colou?r ?blind|diabetic|asthmatic)\b/i;
// A time or day makes it a booking or a reminder ("my meeting is at 3pm"), unless he said "note"/"remember".
const AT_A_TIME = /\b\d{1,2}(?::\d{2})?\s*(?:am|pm)\b|\b(?:today|tonight|tomorrow)\b/i;

// "my dentist appointment is on friday at 3", "my meeting with priya is moved to friday": a booking with a day or
// time goes to the calendar flow; without a day or time it stays a fact (review, 2026-10-16).
const CALENDAR_NOUN = /\b(?:meetings?|appointments?|classes|class|lectures?|exams?|interviews?|dentist|doctor|quiz|office hours)\b/i;
const DAY_OR_TIME = /\b(?:mon|tues?|wed(?:nes)?|thu(?:rs?)?|fri|sat(?:ur)?|sun)(?:day)?\b|\bat\s+\d|\b\d{1,2}\s*(?:am|pm)\b|\bnoon\b/i;
const isCalendarStatement = (m: string) => CALENDAR_NOUN.test(m) && DAY_OR_TIME.test(m);

/** He is telling ORION a fact to keep (not a question, not a reminder at a time). */
export function tellsFact(message: string): boolean {
  const m = message.trim();
  if (/\?\s*$/.test(m)) return false;
  if (TELLS.test(m)) return !/\b(?:remind me|alarm)\b/i.test(m);
  return (MY_FACT.test(m) || STANDING.test(m)) && !AT_A_TIME.test(m) && !isCalendarStatement(m);
}

// "what did i say about…", "who's my lab partner", "whats my allergy", "what time do i usually take it".
const RECALL = /\bwhat (?:did|have) i (?:say|said|tell you|told you|mention)\b|\b(?:what|who|where)(?:'?s| is| are| was)\s+my\b|\bwhats\s+my\b|\bwhos\s+my\b|\bdo you (?:know|remember)\b|\bwhat time do i (?:usually|normally|always)\b|\bhow (?:do|did) i usually\b|\bwhere did i (?:put|leave)\b/i;
// inbox/gmail/mail/imessage/phone time added: "whats my inbox look like" got a brain search (review, 2026-10-16).
// His day is the day reader's job ("what's my next class?"), not his memory's.
const DAY_WORDS = /\b(?:today|tonight|tomorrow|next|this (?:morning|afternoon|evening|week)|class(?:es)?|lectures?|seminars?|meetings?|deadlines?|due|schedule|calendar|agenda|day|weather|texts?|messages?|emails?|inbox|g-?mail|mail|imessages?|phone time|reminders?|alarms?|to-?dos?|tasks|supplements?|session)\b/i;

/** A question about something he told ORION or keeps in his notes. */
export function asksRecall(message: string): boolean {
  return RECALL.test(message) && !DAY_WORDS.test(message);
}

export const FACT_NOTE = [
  "Nick is telling you a fact to remember. Save it now with ONE exec call: /Users/nickmadaio/Desktop/ORION/scripts/orion-brain learn \"Nick\" \"fact\" \"<the fact, short, in the third person>\".",
  "Example — Nick: my lab partner for ds lab is priya → exec orion-brain learn \"Nick\" \"fact\" \"DS lab partner is Priya\" → \"Added to \\\"Nick\\\": …\" → ORION: Saved: your DS lab partner is Priya.",
  "Save the fact itself, never a calendar block, alarm or to-do. The ORION repair queue is only for problems with ORION itself, never for his facts.",
  "Say it is saved only if the learn result shows it was added.",
].join("\n");

export const RECALL_NOTE = [
  "Nick is asking about something he told you or keeps in his notes. Before you reply, search with exec: /Users/nickmadaio/Desktop/ORION/scripts/orion-brain search \"<one or two key words>\". Never offer to search: search, then answer.",
  "Say \"you told me\" or \"you mentioned\" only for facts saved in his \"Nick\" note; anything else (a course page, a policy) is \"your <note> notes say…\". If nothing matches, say you don't have that saved.",
].join("\n");

export const FACT_NOW = "[ORION: save it now with exec orion-brain learn \"Nick\" \"fact\" \"…\" — do not reply before the result.]";
export const RECALL_NOW = "[ORION: run exec orion-brain search first — do not reply before the result.]";
