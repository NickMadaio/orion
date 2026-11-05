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

const OFFER = /\b(?:want me to|want to|shall i|shall we|should i|should we|would you like|do you want|how about|fancy|ready to|say go|log it\?|go ahead\?|ok\?|sound good\?|which one|which (?:of|do you)|or (?:the|a|just|take|do|log|move|start|open)\b[^?]*\?)/i;

/** The question or offer in ORION's last reply: its last question sentence, or the whole reply when it ends in an offer. */
export function resolvePending(last: Said | undefined, now: number): Pending {
  if (!last || now - last.at > PENDING_WINDOW_MS || NOTHING_PENDING_LINES.includes(last.reply.trim())) return { pending: false };
  const text = last.reply.trim();
  const sentences = text.split(/(?<=[.!?])\s+/).filter(Boolean);
  const question = [...sentences].reverse().find((s) => /\?\s*$/.test(s));
  const tail = sentences.at(-1) ?? "";
  // Only a question that OFFERS something is waiting on a yes: "Anything else?" and "What did you mean?" are not.
  if (question && OFFER.test(question)) return { pending: true, refers: question.slice(0, 240) };
  if (OFFER.test(tail)) return { pending: true, refers: tail.slice(0, 240) };
  return { pending: false };
}

const WH_QUESTION = /\b(?:how (?:much|many|long|far|often|big|old)|what(?:'s| is| was| time| kind| size| should| do| did)?|which|when|where|who|why)\b[^.?!]*\?\s*$/i;
/** A short answer that is not a yes/no: a number or a few words ("2", "chicken", "the big one", "at 5"). */
export const isShortAnswer = (message: string): boolean => {
  const m = message.trim();
  return m.length > 0 && m.length <= 40 && m.split(/\s+/).length <= 5 && !/\?\s*$/.test(m) && !/^(?:what|whats|how|when|where|who|why|can|could|would|is|are|do|does)\b/i.test(m);
};
/** ORION's last reply ends with a question that needs an answer ("How much?", "What time?"): a short answer next is that answer. */
export function resolveQuestion(last: Said | undefined, now: number): Pending {
  if (!last || now - last.at > PENDING_WINDOW_MS || NOTHING_PENDING_LINES.includes(last.reply.trim())) return { pending: false };
  const tail = last.reply.trim().split(/(?<=[.!?])\s+/).filter(Boolean).at(-1) ?? "";
  return WH_QUESTION.test(tail) ? { pending: true, refers: tail.slice(0, 240) } : { pending: false };
}

/** The newest exchange across a chat's session keys: the phone sends one conversation under several (as the retry slots already allow). */
export function latestExchange<T extends { at: number }>(all: ReadonlyMap<string, T>, key: string | undefined, isFamily: (k: string) => boolean): T | undefined {
  const own = key ? all.get(key) : undefined;
  if (!key || !isFamily(key)) return own;
  return [...all.entries()].filter(([k]) => k === key || isFamily(k)).map(([, v]) => v).sort((a, b) => b.at - a.at)[0] ?? own;
}

/** What a bare go-ahead gets when nothing is waiting. */
export const nothingPending = (message: string): string => NOTHING_PENDING_LINES[[...message].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % NOTHING_PENDING_LINES.length]!;

/** The note for the worker when something IS pending: his word answers exactly that. */
export const pendingNote = (message: string, refers: string): string =>
  `[ORION: his "${message}" answers the last thing you asked or offered: "${refers}". Do exactly that and nothing else; never invent another question, a bedtime or a task he did not mention. If it asked him to choose between options and "${message}" does not choose, ask which one in a few words.]`;

export { isBareGoAhead };
