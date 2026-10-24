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
export type OutreachPlan = {
    text: string;
    checkin?: string[];
};
export declare function kindOf(text: string, hint?: string): OutreachKind;
/** The planned block a "start" line is about: "Time to start: Gym." / "Gym — still not started" / "It's been 30 min. Gym, now." */
export declare function titleOf(text: string, label?: string): string | undefined;
/** What ORION said first, from the Mac label or the phone's context line; undefined when the prompt carries neither. */
export declare function parseOutreach(prompt: string): Outreach | undefined;
/** Short answers, read on their own; undefined for anything longer or unclear (the worker reads those, with the context). */
export declare function readShortReply(message: string): ShortReply | undefined;
/** Code's whole answer to a short reply to a bedtime or start line, and the check-in it sets; undefined → the worker, with the context. */
export declare function planOutreachReply(o: Outreach, message: string): OutreachPlan | undefined;
/** For the worker when code does not answer: ORION's own message, as the conversation it is, and how to read his answer. */
export declare function outreachNote(o: Outreach): string;
/** The front desk's "Earlier:" turn. */
export declare const outreachHistory: (o: Outreach) => {
    role: "assistant";
    content: string;
}[];
