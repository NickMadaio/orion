import type { Day } from "./schedule-flow.js";
/** What the exec wrapper hands back when the scheduler died without a word. */
export declare const UNKNOWN_OUTCOME = "OUTCOME UNKNOWN: the scheduler stopped before it reported back.";
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
/** What differs between two reads of the same day, in plain words: added, removed, moved. */
export declare function dayDiff(before: Day, after: Day): string[];
/** After a crash or an unknown outcome: what the calendar reads now against before, or that it cannot be known. Never "nothing changed". */
export declare function uncertainReply(before: Day | undefined, after: Day | undefined, when?: string): string;
