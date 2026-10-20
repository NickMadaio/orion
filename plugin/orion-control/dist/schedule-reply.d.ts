export declare const FAILED: RegExp;
/** One scheduler failure line → one short spoken clause. The raw line was spoken word for word (sweep
 *  2026-10-16): usage text, "Blocks today: … 09:00–10:30", "Do not tell him anything was added". */
export declare function spokenFailure(line: string): string;
/** What to tell Nick, from the scheduler's own output only. */
export declare function summarize(outputs: string[], said: string[]): {
    reply: string;
    changed: boolean;
};
/** A scheduler run that says it wrote nothing (its first line is "NOTHING WAS CHANGED/BOOKED"). */
export declare const nothingWritten: (out: string) => boolean;
/** The spoken reply, built only from the scheduler's lines ("planned X: 17:15–18:00", "X moved: a → b–c"). */
export declare function spokenReply(outputs: string[], when?: string): string;
