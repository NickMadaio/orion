/*
 ONE answer to "what is he saying yes to?" (w20 round 6, live gate 4 #35 #36 #84 #85). A bare "that one" / "go" / "yeah go on then" used to reach
 the worker with nothing to resolve against, and it invented a context (a bedtime push it never sent, "you're good to start your day").
 The rule, for every confirmation path that has nothing of its own to answer: it refers to the LATEST thing ORION said in this chat, and only if
 that was a question or an offer. Otherwise nothing is pending and the answer says so. `at` is when ORION said it.
*/
import { isBareGoAhead, NOTHING_PENDING_LINES } from "./honest-reply.js";

export const PENDING_WINDOW_MS = 15 * 60_000;
export type Said = { reply: string; at: number };
export type Pending = { pending: true; refers: string } | { pending: false };

const OFFER = /\b(?:want me to|shall i|should i|would you like me to|do you want me to|say go|log it\?|go ahead\?|ok\?|sound good\?|which one|which (?:of|do you)|or (?:the|a|just)\b[^?]*\?)/i;

/** The question or offer in ORION's last reply: its last question sentence, or the whole reply when it ends in an offer. */
export function resolvePending(last: Said | undefined, now: number): Pending {
  if (!last || now - last.at > PENDING_WINDOW_MS) return { pending: false };
  const text = last.reply.trim();
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const question = [...sentences].reverse().find((s) => /\?\s*$/.test(s));
  const tail = sentences.at(-1) ?? "";
  if (question && (OFFER.test(question) || /\?\s*$/.test(tail))) return { pending: true, refers: question.slice(0, 240) };
  if (OFFER.test(tail)) return { pending: true, refers: tail.slice(0, 240) };
  return { pending: false };
}

/** What a bare go-ahead gets when nothing is waiting. */
export const nothingPending = (message: string): string => NOTHING_PENDING_LINES[[...message].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % NOTHING_PENDING_LINES.length]!;

/** The note for the worker when something IS pending: his word answers exactly that. */
export const pendingNote = (message: string, refers: string): string =>
  `[ORION: his "${message}" answers the last thing you asked or offered: "${refers}". Do exactly that and nothing else; never invent another question, a bedtime or a task he did not mention. If it asked him to choose between options and "${message}" does not choose, ask which one in a few words.]`;

export { isBareGoAhead };
