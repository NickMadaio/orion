export declare const ANSWERED_FILE = "pending-answered.json";
export type AnsweredRow = {
    text: string;
    sentAt: number;
    answeredAt: number;
};
export declare function readAnswered(dir: string): AnsweredRow[];
/** Whether this outreach (its text, sent at sentAt) was already answered, in `rows`. Pure. */
export declare function answeredIn(rows: readonly AnsweredRow[], text: string, sentAt: number, nowMs: number): boolean;
/** `rows` with this outreach marked answered, old rows dropped. Pure. */
export declare function withAnswered(rows: readonly AnsweredRow[], text: string, sentAt: number, nowMs: number): AnsweredRow[];
/** Writes the rows atomically (temp file, then rename). Best effort: a failed write leaves the caller's memory copy in charge. */
export declare function writeAnswered(dir: string, rows: readonly AnsweredRow[]): boolean;
