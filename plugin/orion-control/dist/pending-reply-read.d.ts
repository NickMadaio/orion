export type Offer = {
    kind: "start";
    title: string;
} | {
    kind: "leave";
    title: string;
    leaveIn: number;
    classAt?: number;
} | {
    kind: "bedtime";
} | {
    kind: "catchup";
    subject?: string;
} | {
    kind: "slipped";
    title: string;
} | {
    kind: "brief";
    items: string[];
} | {
    kind: "session-done";
    next?: string;
} | {
    kind: "plan-check";
    title: string;
};
export type Part = "morning" | "afternoon" | "evening";
/** What a counter-offer names: a day, a part of it, a clock time (minutes after midnight; meridiem when he said am/pm or a 24-hour time), a length, a block to follow. */
export type Details = {
    day?: "today" | "tomorrow";
    part?: Part;
    at?: number;
    meridiem?: boolean;
    minutes?: number;
    after?: string;
};
export type Reply = {
    kind: "accept";
    pick: boolean;
} | {
    kind: "indifferent";
} | {
    kind: "decline";
} | {
    kind: "done";
} | {
    kind: "resume";
} | {
    kind: "changed";
} | {
    kind: "defer";
    minutes?: number;
    activity?: string;
    typical?: number;
} | {
    kind: "awake";
    activity?: string;
    minutes?: number;
    sleepless: boolean;
    workload: boolean;
} | {
    kind: "workload";
} | {
    kind: "next";
} | {
    kind: "counter";
    details: Details;
    text: string;
};
/** The offer in ORION's own message; undefined when it is not one this module carries out. */
export declare function offerOf(text: string): Offer | undefined;
/** Every clock time in his words, in order, with where it was said: "9am", "at 4", "8:30", "at eight". A length ("25 min") is not a time. */
export declare function clockTimes(m: string): Array<{
    at: number;
    index: number;
    meridiem: boolean;
}>;
/** The details of a counter-offer, or undefined when it names none. */
export declare function detailsOf(message: string): Details | undefined;
/** He asked for quiet: the bedtime line's own handling (outreach-reply.ts) answers that, not a cap. */
export declare const HUSH: RegExp;
/** A request of his own in the reply ("not yet, but can you move gym to 8"): the normal turn's, with the context. */
export declare const REQUEST: RegExp;
/** At most this many words for a reply code reads against the offer; a longer message is a request of its own. */
export declare const REPLY_MAX_WORDS = 16;
/** What his reply is, read against nothing yet (the offer decides what each kind means); undefined when it is not a reply. */
export declare function readReply(message: string): Reply | undefined;
export declare function pauseThenStart(message: string): {
    activity: string;
    minutes?: number;
    typical?: number;
    title: string;
} | undefined;
