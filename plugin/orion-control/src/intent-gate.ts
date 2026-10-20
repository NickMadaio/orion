/*
 The allow-only gate in front of every code-run calendar change (calendar-intent.ts). Moved here unchanged from day-replan.ts
 (review rounds 1-3, 2026-10-20) so the replan, the add, the move and the follow-up readers share ONE set of rules:

   - the message must START with the request (after only a courtesy word) and use an imperative verb;
   - a question, a take-back at the end (jk, nvm, lol), doubt (idc, or whatever), second thoughts (actually, wait, no),
     a negation or past tense, and reported speech (she said …) are never a request;
   - every check runs on what he typed AND on the typo-fixed text ("nvrmind", "lmaoo", "my coach sayd").

 A message the gate refuses goes the normal way; it is never guessed at.
*/

// ---- typos: "resched my day, gim frist" is still a request (live test 2026-10-20) ----
const ALIASES: Record<string, string> = { gim: "gym", gymm: "gym", frist: "first", firts: "first", fisrt: "first", priorty: "priority", priorety: "priority", prority: "priority",
  evning: "evening", evenin: "evening", evenig: "evening", tonite: "tonight", thne: "then", tehn: "then", hten: "then", resched: "reschedule", reshed: "reschedule",
  resch: "reschedule", replna: "replan", u: "you", plz: "please", pls: "please", ok: "ok", tmrw: "tomorrow", tmr: "tomorrow", tmrow: "tomorrow", tomoz: "tomorrow",
  "2moro": "tomorrow", "2morrow": "tomorrow", tomorow: "tomorrow", tommorow: "tomorrow", tommorrow: "tomorrow" };
const VOCAB = ["reschedule", "replan", "rearrange", "reorganize", "reorganise", "evening", "afternoon", "priority", "lecture", "before"];   // words of 5+ letters only: "when" is not a typo of "then"

/** Edit distance (insert, delete, substitute), for typo matching. */
export function lev(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i += 1) { let prev = row[0]!; row[0] = i; for (let j = 1; j <= b.length; j += 1) { const t = row[j]!; row[j] = Math.min(t + 1, row[j - 1]! + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = t; } }
  return row[b.length]!;
}

/** Common typos in a request's key words, fixed by an alias list and a small edit distance against the words the parser reads. */
export function fixTypos(text: string): string {
  return text.replace(/[A-Za-z0-9]+/g, (w) => {
    const lower = w.toLowerCase();
    if (ALIASES[lower] && ALIASES[lower] !== lower) return ALIASES[lower]!;
    if (lower.length < 5 || VOCAB.includes(lower) || /\d/.test(lower)) return w;
    const near = VOCAB.find((v) => v[0] === lower[0] && Math.abs(v.length - lower.length) <= 2 && lev(v, lower) <= (v.length >= 8 ? 2 : 1));
    return near ?? w;
  });
}

// Only an imperative request fires: a hypothetical, a question, a negation, a past event or a plan he is only thinking about does not rewrite his day.
export const NOT_A_REQUEST = /\b(?:don'?t|do not|dont|doesn'?t|never ?mind|nvm|no need|not|n'?t|rescheduled|replanned|rearranged|reorgani[sz]ed|did|had|already|was going to|were going to|used to|going to|gonna|should|shall|what if|what about|how about|thinking|wondering|maybe|perhaps|might|could i|can i|may i|whether|if i|if we|would it|would i|why|supposed to|unless|if it|decide later|i guess|meh)\b/i;
export const COURTESY = /^(?:(?:ok(?:ay)?|so|yo|hey|please|pls|orion|can u|can you|could you|would you|will you|just)[,.\s]+)*/i;
const IMPERATIVE = /^(?:re-?schedule|re-?do|re-?plan|re-?arrange|re-?organi[sz]e|re-?work|move|push|put|shift|do|have|start)\b|^(?:after|when|once)\b[^,.;]*?[,\s]+(?:do|put|have|start with)\b/i;
export const TAKEN_BACK = /(?:\bjk+|\bj\/k|just kidding|\bkidd?in[g']?|\bjkjk|\bn(?:ever|evr|vr)\s*-?\s*m(?:i|y)?n?d\b|\bnevermnd|\bnvm+|\blo+l+z*|\blm+a+o+|\bro+fl|\bha(?:ha)+h?|\bor not|\bscratch that|\bforget (?:it|that)|\bi dunno|\bdunno|\bidc|\bi don'?t care|\bwhatever|\bidk|\bgot nothing)\W*$/i;
// Doubt in the middle of the message: "gym first or whatever, idc".
// Trailing hedges too ("gym first ish", "… kinda?", "idk tho"): a hedge at the end is not an order (review 2026-10-21). "im kinda tired tho" mid-sentence is not one.
export const DOUBT = /\b(?:or whatever|dunno|idc|idek|idk|i don'?t care|not sure|no idea|who knows|or something|or smth|or sth|or smthn|or somethin|i guess|meh)\b|\b(?:ish|kinda|sorta|maybe|probably|prob|idk tho|i think)\W*$/i;
/** The replan gate: the message starts with the request and does not take it back at the end. */
export const startsAsRequest = (text: string): boolean => { const rest = text.replace(COURTESY, ""); return IMPERATIVE.test(rest) && !TAKEN_BACK.test(text); };
// Second thoughts, doubt and hearsay anywhere in the message: not an order (review round 3, 2026-10-20).
export const SECOND_THOUGHTS = /\b(?:actually|wait|no|nah|nope|forget|hmm+|idk|or is that|or not|on second thought|scratch that|ugh)\b/i;
export const HEARSAY = /\b(?:she|he|they|someone|mom|mum|dad|my \w+)\s+(?:\w+\s+)?(?:told|tld|said|sayd|sed|sez|says|tells|asked|wants)\b|\b(?:told|tld|said|sayd|sed|asked) me\b/i;
export const POLITE = /^(?:(?:hey|ok(?:ay)?|so|please|pls|orion)[,\s]+)*(?:can|could|would|will)\s+(?:you|u)\b/i;

/** A report of what already happened ("we did resume then gym", "i went to the gym first"): never a follow-up order. */
export const PAST_REPORT = /\b(?:we|i|he|she|they)\s+(?:already\s+|just\s+)?(?:did|went|had|finished|was|were|got|started|ended|ran|left)\b|\b(?:did|went|finished|was|were|happened)\b/i;

export type Refusal = "question" | "take-back" | "doubt" | "hearsay" | "second-thoughts" | "not-a-request";

/** A question is not an order, but "can you … ?" ending the message is a polite one. */
export const isQuestionText = (text: string): boolean => text.includes("?") && !(POLITE.test(text) && text.indexOf("?") === text.length - 1);

/**
 * Why this message is not an order, or undefined when nothing rules it out. Runs on the raw and the typo-fixed text.
 * `lenient`: second thoughts and the negation list are not checked (a follow-up "actually do resume before gym", or an add
 * after "I'm fine… I'm just annoyed"), but take-backs, doubt, hearsay and questions always are.
 */
export function refusalOf(raw: string, opts: { lenient?: boolean; followUp?: boolean } = {}): Refusal | undefined {
  const fixed = fixTypos(raw);
  const both = [raw, fixed];
  if (both.some((t) => DOUBT.test(t))) return "doubt";   // first: "gym first kinda?" is a hedge, as well as a question
  if (isQuestionText(fixed)) return "question";
  if (both.some((t) => TAKEN_BACK.test(t))) return "take-back";
  if (both.some((t) => HEARSAY.test(t))) return "hearsay";
  if (opts.lenient && opts.followUp && both.some((t) => PAST_REPORT.test(t))) return "not-a-request";
  if (opts.lenient) return both.some((t) => /\b(?:don'?t|do not|maybe|should|what if|or is that|unless|if it|decide later)\b/i.test(t)) ? "not-a-request" : undefined;
  if (both.some((t) => SECOND_THOUGHTS.test(t))) return "second-thoughts";
  if (both.some((t) => NOT_A_REQUEST.test(t))) return "not-a-request";
  return undefined;
}
