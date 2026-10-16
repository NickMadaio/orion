/** "That would push …" — the exact argv list (no --dry-run, dateArgs included) to run on a yes. */
export type PushPending = {
    kind: "push";
    argvs: string[][];
    displaced: string[];
    when?: string;
};
/** "What should I put before …?" — the anchor to keep when he names the thing. */
export type TitlePending = {
    kind: "title";
    ask: string;
    minutes?: number;
    dateArgs: string[];
    when?: string;
    before?: {
        minute: number;
        label: string;
    };
    afterTitle?: string;
    /** HIGH-1 (r8 review 4): the question was already asked a second time; a third non-answer clears it. */
    reasked?: boolean;
};
export type PendingAdd = PushPending | TitlePending;
/** What the flow is told to do for a pending answer. */
export type PendingRun = PushPending | (TitlePending & {
    title: string;
});
export declare const ADD_DECLINED = "Okay, I left your day as it is.";
export type PendingAnswer = {
    kind: "run";
    run: PendingRun;
} | {
    kind: "decline";
} | {
    kind: "reask";
    pending: TitlePending;
};
export declare const isYes: (m: string) => boolean;
export declare const isNo: (m: string) => boolean;
/** His short answer to "what should I put there?": "laundry", "yes, laundry", "put in email". Null if it is not one. */
export declare function titleAnswer(message: string): string | null;
/** Reads his reply against the stored question. Undefined: it is not an answer (the caller clears the pending add). */
export declare function answerPending(pending: PendingAdd, message: string): PendingAnswer | undefined;
