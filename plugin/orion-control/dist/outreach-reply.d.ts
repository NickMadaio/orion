export type OutreachKind = "bedtime" | "start" | "question" | "info";
export type Outreach = {
    text: string;
    minutes: number;
    kind: OutreachKind;
    title?: string;
};
export type ShortReply = {
    kind: "yes";
} | {
    kind: "no";
} | {
    kind: "not-yet";
} | {
    kind: "later";
    minutes: number;
} | {
    kind: "done";
} | {
    kind: "stop";
} | {
    kind: "other";
    activity: string;
};
export declare function kindOf(text: string, hint?: string): OutreachKind;
/** The planned block a "start" line is about: "Time to start: Gym." / "Gym — still not started" / "It's been 30 min. Gym, now." */
export declare function titleOf(text: string, label?: string): string | undefined;
/** What ORION said first, from the Mac label or the phone's context line; undefined when the prompt carries neither. */
export declare function parseOutreach(prompt: string): Outreach | undefined;
/** At most this many words: a short answer is the WHOLE reply (review 2026-10-23: "set an alarm for 8 am" read "am" as a+m). */
export declare const SHORT_MAX_WORDS = 6;
/** A short answer, only when it is the WHOLE reply (anchored, six words or fewer, nothing else in it); undefined otherwise. */
export declare function readShortReply(message: string): ShortReply | undefined;
/** What to do with the ONE plan loop the start line belongs to (found by `orion-checkin find`, never "the newest"). */
export type LoopAct = {
    verb: "defer";
    minutes: number;
    because: string;
} | {
    verb: "started";
} | {
    verb: "done";
};
export type OutreachPlan = {
    text: string;
    act?: LoopAct;
    find?: {
        what: string;
    };
};
/**
 * Code's whole answer to a short reply to a bedtime or start line; undefined → the normal turn, which has the context.
 * A start line's loop is acted on by its id only (the caller finds it); a "no" or "stop" to a start line is never acted on by
 * code (it cancelled the newest check-in and removed a calendar block, review 2026-10-23).
 */
export declare function planOutreachReply(o: Outreach, message: string): OutreachPlan | undefined;
/** argv for orion-checkin acting on loop `id`. */
export declare const loopArgs: (act: LoopAct, id: string) => string[];
/** For the worker when code does not answer: ORION's own message, as the conversation it is, and how to read his answer. */
export declare function outreachNote(o: Outreach): string;
/** The front desk's "Earlier:" turn. */
export declare const outreachHistory: (o: Outreach) => {
    role: "assistant";
    content: string;
}[];
