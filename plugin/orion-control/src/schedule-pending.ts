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
export const isNo = (m: string): boolean => NO.test(m.trim()) && m.trim().split(/\s+/).length <= 3;

/** His short answer to "what should I put there?": "laundry", "um maybe stretching", "put in email". Null if it is not one. */
export function titleAnswer(message: string): string | null {
  const m = message.trim().replace(/[.!\s]+$/, "");
  if (!m || /\?/.test(m) || m.split(/\s+/).length > 6 || isYes(m) || isNo(m) || NEW_REQUEST.test(m)) return null;
  const title = m.replace(LEAD, "").trim();
  return title && /[a-z]/i.test(title) ? title.replace(/^./, (c) => c.toUpperCase()) : null;
}

/** Reads his reply against the stored question. Undefined: it is not an answer (the caller clears the pending add). */
export function answerPending(pending: PendingAdd, message: string): PendingAnswer | undefined {
  if (isNo(message)) return { kind: "decline" };
  if (pending.kind === "push") return isYes(message) ? { kind: "run", run: pending } : undefined;
  if (isYes(message)) return { kind: "reask", pending };
  const title = titleAnswer(message);
  return title ? { kind: "run", run: { ...pending, title } } : undefined;
}
