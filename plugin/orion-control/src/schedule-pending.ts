/*
 The follow-up to a schedule-flow question about an add (r8 review 3, H1, 2026-10-16).

 "That would push Gym later — go ahead?" and "What should I put before your 1:30 PM class?" are answered
 on the NEXT turn. Without a stored question the answer went to the worker with general tools, which is
 exactly how an unanchored `add` got run (the live 5:50 PM bug). So the flow hands back what it asked
 (`pending`), local-routing keeps it for a few minutes, and this module reads the answer:
   yes / go ahead      → run exactly the stored argv (nothing is recompiled)
   a short title       → compile again with the stored anchor and that title (still previewed)
   no / nah            → nothing runs
 Any other turn clears it. Nothing else ever runs an unanchored add on those answers.
*/
import { isBareYes } from "./late-flow.js";

/** "That would push …" — the exact argv list (no --dry-run, dateArgs included) to run on a yes. */
export type PushPending = { kind: "push"; argvs: string[][]; displaced: string[]; when?: string };
/** "What should I put before …?" — the anchor to keep when he names the thing. */
export type TitlePending = {
  kind: "title"; ask: string; minutes?: number; dateArgs: string[]; when?: string;
  before?: { minute: number; label: string }; afterTitle?: string;
  /** HIGH-1 (r8 review 4): the question was already asked a second time; a third non-answer clears it. */
  reasked?: boolean;
};
export type PendingAdd = PushPending | TitlePending;
/** What the flow is told to do for a pending answer. */
export type PendingRun = PushPending | (TitlePending & { title: string });

export const ADD_DECLINED = "Okay, I left your day as it is.";
export type PendingAnswer =
  | { kind: "run"; run: PendingRun }
  | { kind: "decline" }
  | { kind: "reask"; pending: TitlePending };

const GO_AHEAD = /^(?:(?:yeah|yea|yes|yep|yup|ok(?:ay)?|sure|please|pls|alright|fine)[,\s]+)*(?:go ahead|do it|go for it|sounds good|that works|yeah|yea|yes|yep|yup|ok(?:ay)?|sure|fine|alright|please|pls)(?:[,\s]+(?:please|pls|thanks|thank you))?[.!\s]*$/i;
const NO = /^(?:no|nah|nope|never ?mind|don'?t|do not|cancel|forget it|leave it|skip it|not now|stop)\b/i;
const LEAD = /^(?:(?:um+|uh+|hmm+|maybe|just|how about|what about|let'?s (?:do|say)|put in|put|add|do|something like|a|an|some|the|my|one|quick|small)\s+)+/i;
const NEW_REQUEST = /\b(?:add|move|push|cancel|remind|skip|drop|schedule|swap|resize|extend|undo|running late|late|tomorrow|today)\b|\d/i;

export const isYes = (m: string): boolean => isBareYes(m) || GO_AHEAD.test(m.trim());
export const isNo = (m: string): boolean => NO.test(m.trim().replace(/^(?:actually|oh|um+|uh+|well)[,\s]+/i, "")) && m.trim().split(/\s+/).length <= 3;

/** Leading acknowledgements: "yes, laundry" is "laundry" (r8 review 4 HIGH-1, 2026-10-16). */
const ACK = /^(?:(?:yes|yeah|yea|yep|yup|ok(?:ay)?|sure|alright|well|so|actually|oh)[,\s]+)+/i;
/** Not a thing to put on the calendar: a question, or about himself or the assistant. Device verbs are NOT listed (review 5 M5, 2026-10-16: "call mom", "text Sam back", "start my essay", "set up my desk", "log my expenses" are titles; "turn off the lights" is caught by the front desk's tool move). */
const NOT_A_TITLE = new RegExp(String.raw`^(?:(?:what|when|where|who|whom|whose|how|why|which|can|could|would|will|should|is|are|am)\b|(?:do|does|did)\s+(?:you|i|we|they|it|u)\b|(?:i|i'm|im|i'll|i've|i'd|you|you're|youre|u|we|let me)\b|turn (?:on|off)\b|lights? (?:on|off|out)\b|play (?:some |my |the )?(?:music|songs?|playlist|spotify|podcast)\b|pause (?:the |my )?(?:music|song|timer|playback)\b|open (?:the )?(?:app|spotify|safari|settings|[a-z]+\.app)\b|unlock (?:my )?(?:phone|mac|door|computer)\b|set (?:a|an) (?:timer|alarm)\b|log water\b)`, "i"); // device commands (review 6 M-A): booked when the front desk escalated or errored
/** Replies that mean "you decide": asked once more, then left alone. */
const YOU_DECIDE = /^(?:idk|i don'?t know|dunno|not sure|you (?:pick|choose|decide)|up to you|surprise me|whatever|anything)\b/i;
/** Replies that are not an answer at all: nothing is booked, the turn routes normally. */
const NON_ANSWER = /^(?:thanks?(?: you)?|thx|hmm+|hold on|wait|not really|never ?mind|nvm|that'?s fine|lol|nothing|no thanks)\b|^(?:ok\s+)?(?:perfect|cool|absolutely|great|nice|awesome|good|fine by me|sounds (?:good|great)|that'?s (?:great|good|fine)|hm+ ok)(?:[,!\s]+(?:thanks?|thank you|thx|idea|one|job|cool|great|stuff|work|sauce))*$/i; // praise words only when they are the whole reply: "great gatsby reading", "cool down stretch" are titles (review 5 M5)

const stripAck = (m: string): string => m.replace(ACK, "").trim();

/** His short answer to "what should I put there?": "laundry", "yes, laundry", "put in email". Null if it is not one. */
export function titleAnswer(message: string): string | null {
  const m = message.trim().replace(/[.!\s]+$/, "");
  if (!m || /\?/.test(m) || m.split(/\s+/).length > 6 || isYes(m) || isNo(m) || NEW_REQUEST.test(m)) return null;
  const bare = stripAck(m);
  if (!bare || isYes(bare) || NOT_A_TITLE.test(bare) || YOU_DECIDE.test(bare) || NON_ANSWER.test(bare) || YOU_DECIDE.test(m) || NON_ANSWER.test(m)) return null;
  const title = bare.replace(LEAD, "").trim();
  return title && /[a-z]/i.test(title) ? title.replace(/^./, (c) => c.toUpperCase()) : null;
}

/** Reads his reply against the stored question. Undefined: it is not an answer (the caller clears the pending add). */
export function answerPending(pending: PendingAdd, message: string): PendingAnswer | undefined {
  if (isNo(message)) return { kind: "decline" };
  if (pending.kind === "push") return isYes(message) ? { kind: "run", run: pending } : undefined;
  // A yes, or "you pick", is not a title: ask once more, then leave it (a third non-answer clears the question).
  if (isYes(message) || YOU_DECIDE.test(stripAck(message.trim()))) return pending.reasked ? undefined : { kind: "reask", pending: { ...pending, reasked: true } };
  const title = titleAnswer(message);
  return title ? { kind: "run", run: { ...pending, title } } : undefined;
}
