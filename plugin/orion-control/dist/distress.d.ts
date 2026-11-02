/** The life-and-death space by itself (REV5): what must never be read as a preference, a plan or a setting, even where isCrisis's
 *  narrower idiom rules would let a line through. Broad on purpose: a false hold costs only the worker answering instead. */
export declare const touchesLifeOrDeath: (message: string) => boolean;
export declare const CRISIS_REPLY = "I'm really sorry it feels this heavy, Nick, and I'm glad you told me. Are you safe right now? If you might be in danger call 999, and you can call Samaritans free any time on 116 123 or NHS on 111 \u2014 I'm here too if you want to talk.";
export declare const SUPPORT_LINE = "Are you safe right now? If not, call 999, or Samaritans free on 116 123.";
export declare const OVERWHELMED_NOTE = "Nick is feeling overwhelmed. Answer with warmth in two short spoken sentences: say you hear him, then suggest ONE small first step he could take in the next few minutes (a breath, a stretch, writing down the one thing due first). Do not call any tools, do not look anything up, and do not read out his schedule.";
export type CrisisTier = "full" | "gentle" | null;
/** Which tier this message is: the fixed reply (full), a normal turn with one teasing line first (gentle), or nothing. Pure. */
export declare function crisisTier(message: string): CrisisTier;
/** The one short, dry tease that opens a GENTLE turn: names his cause when he gave one, varies by message, stable for the same one. */
export declare function gentleCheckIn(message: string): string;
/** The reply with the gentle check-in in front, once (a text that already opens with it is left as it is). */
export declare function withGentleCheckIn(message: string, text: string): string;
export declare const isCrisis: (message: string) => boolean;
export declare const isOverwhelmed: (message: string) => boolean;
