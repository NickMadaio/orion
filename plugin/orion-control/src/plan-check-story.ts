/*
 His free-text answer to the off-plan question (w16 a-reply, 2026-11-02 23:04 live).

 ORION asked "You're out - is Go over Orion learning plan still happening, or did plans change?" and Nick answered in one run-on: at a
 friend's place, away right now, postpone that. The short-reply reader (pending-reply-read.ts) stops at 16 words, so nothing bound it to
 the question, and the reality reader took "i went to wales with" as a class attended ("Got it, you were at wales with. Noted as
 attended"). Here a longer answer to THAT question is read by what it says about the plan:
   plans changed   postpone / push it / not happening / cant do it / skip it, or only that he is out (a friend's place, away rn)
   still on        still happening / ill still do it / omw home / be back in 20
   unsure          both at once, "idk", or only where he is ("im at the library"): one short question, nothing written
 A clock time or "tomorrow" with a change is a counter (the move flow asks or moves). Pure: strings in, values out.

 readPersonMention keeps only a durable fact about a person he names: a name, a relation and a trip they took together, built from those
 pieces, never his free text. How he feels about them is never kept.
*/
import { detailsOf, type Reply } from "./pending-reply-read.js";

export type StoryReply = Extract<Reply, { kind: "changed" | "accept" | "unclear" | "counter" }>;

const tidy = (s: string) => s.toLowerCase().replace(/[‘’`]/g, "'").replace(/\s+/g, " ").trim();
const QUESTION = /\?\s*$|^(?:what|whats|what's|how|when|where|why|who|can|could|would|will|do|does|is|are)\b/;
const CHANGED = /\b(?:postpone\w*|push (?:it|that|this)\b|move (?:it|that|this)\b|reschedule\w*|do it (?:later|tomorrow|tmrw|another time)|another time|rain ?check|not (?:gonna|going to|gna) (?:happen|make it|do it)|not happening|isn'?t happening|aint happening|can'?t (?:do it|make it)|cant (?:do it|make it)|won'?t (?:do it|make it)|skip (?:it|that|this|today|tonight)|plans? changed|change of plans?|called off|cancell?ed|so no|so nah|nah not|(?:it'?s|its|that'?s|thats|it is) off)\b/;
const STILL = /\bstill (?:happening|on|going|doing it|gonna do it|going to do it|do it|planning (?:on|to))\b|^(?:y|ye|ya|yea|yeah|yes|yep|yup)\s+(?:it'?s\s+|its\s+)?(?:happening|on|going)\b|\bi'?ll still\b|\bill still\b|\bon my way\b|\bomw\b|\bheading (?:home|back)\b|\bbe back in\b|\bdoing it (?:now|soon|when)\b/;
const AWAY = /\b(?:i'?m|im|i am) (?:out|away|not home|not in)\b|\baway (?:right now|rn|atm|for now|tonight|for a bit)\b|\bout (?:w|with) \w+|\b(?:at|over at) (?:a |my )?friends?'?s?\b|\b(?:at|over at) [a-z]+'?s (?:place|house|flat|apartment|dorm|room)\b|\bgot dragged out\b|\bout (?:to|for) (?:dinner|drinks|food|lunch)\b/;
const WHERE = /\b(?:i'?m|im|i am) (?:at|in|with)\b|^at (?:the|a|my)\b/;
const UNSURE = /\b(?:idk|i dunno|dunno|not sure|maybe|we'?ll see|depends)\b/;
const NAMED_PLACE = /\b(?:at|over at)\s+([A-Za-z][a-z]{1,20}'s)\s+(?:place|house|flat|apartment|dorm|room)\b/;
const MAX_WORDS = 80;

const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

/** What his answer to "is X still happening, or did plans change?" says; undefined when it is not an answer to it. */
export function readPlanCheckStory(message: string): StoryReply | undefined {
  const m = tidy(message);
  if (!m || QUESTION.test(m) || m.split(" ").length > MAX_WORDS) return undefined;
  const changed = CHANGED.test(m); const still = STILL.test(m);
  if (changed && still) return { kind: "unclear" };
  if (changed) {
    const details = detailsOf(m);
    if (details && (details.at !== undefined || details.day === "tomorrow")) return { kind: "counter", details, text: m };
    return awayReply(message, m);
  }
  if (still) return { kind: "accept", pick: false };
  if (UNSURE.test(m)) return { kind: "unclear" };
  if (AWAY.test(m)) return awayReply(message, m);
  if (WHERE.test(m)) return { kind: "unclear" };
  return undefined;
}

/** away: the place he named ("Avery's"), "" when he only said he is out, absent when he said neither. */
function awayReply(message: string, m: string): StoryReply {
  const place = message.replace(/[‘’`]/g, "'").match(NAMED_PLACE)?.[1];
  return { kind: "changed", ...(place ? { away: cap(place) } : AWAY.test(m) ? { away: "" } : {}) };
}

// ---------------------------------------------------------------- a person he names

export type PersonMention = { name: string; fact: string; echo: string };

const NAME_AT = /\b(?:at|over at)\s+([A-Z][a-z]{1,20})'s\s+(?:place|house|flat|apartment|dorm|room)\b/;
const RELATION = /\b(?:she'?s|shes|he'?s|hes|they'?re|theyre)\s+(?:a|my|our)\s+(?:(?:super|really|very|good|close|old|best|cool|great|chill|new)\s+)*(friend|firiend|freind|frend|roommate|flatmate|housemate|classmate|coworker|teammate|cousin)\b/i;
const TRIP = /\bi\s+(?:went|travell?ed)\s+to\s+([a-z]+(?:\s[a-z]+)?)\s+with\b/i;
const NOT_A_TRIP = /^(?:the|a|an|my|her|his|their|class|school|work|bed|gym|uni|campus|lecture)\b/i;
const FRIEND_TYPO = /^(?:firiend|freind|frend)$/i;

/** A durable fact about a person he names (who they are to him, a trip they shared); undefined when there is none. */
export function readPersonMention(message: string): PersonMention | undefined {
  const text = message.replace(/[‘’`]/g, "'");
  const name = text.match(NAME_AT)?.[1];
  const rel = text.match(RELATION)?.[1];
  if (!name || !rel) return undefined;
  const relation = FRIEND_TYPO.test(rel) ? "friend" : rel.toLowerCase();
  const tripRaw = text.match(TRIP)?.[1];
  const trip = tripRaw && !NOT_A_TRIP.test(tripRaw) ? tripRaw.split(" ").map(cap).join(" ") : undefined;
  return trip
    ? { name, fact: `a ${relation}; went to ${trip} together`, echo: `${name} is a ${relation} you went to ${trip} with` }
    : { name, fact: `a ${relation}`, echo: `${name} is your ${relation}` };
}
