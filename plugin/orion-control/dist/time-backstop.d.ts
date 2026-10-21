import { type DayWord } from "./intent-time.js";
/** Every start he says for the thing being written, as the minutes each could be: "tonight at 7" -> [[1140]], "at 9" tomorrow -> [[540, 1260]]. */
export declare function statedStarts(message: string, ctx: {
    day: DayWord;
    now: number | null;
}): number[][];
/** The start a scheduler argv would write, per block: add --at, move --to, now --at, each day --plan's time. Empty: it picks the time itself. */
export declare function writtenStarts(argv: string[]): number[];
/**
 * A lone add or move that simply left out the one start he said (the form wrote `add walk 45`, no --at, for "45 min walk today at 5pm"): the start
 * is put in, so a correct 17:00 write runs instead of being refused (live run 4). Anything else (a different time written, several writes,
 * an anchor, two times said, a time with two readings) returns undefined and the mismatch check decides.
 */
export declare function repairStart(message: string, argvs: string[][], ctx: {
    day: DayWord;
    now: number | null;
}): string[][] | undefined;
/** What to say instead of running these writes, or undefined when every time he said is a start one of them uses. */
export declare function timeMismatch(message: string, argvs: string[][], ctx: {
    day: DayWord;
    now: number | null;
}): string | undefined;
/** A shell command line's words, quotes kept together. */
export declare function commandArgs(command: string): string[];
/** Each calendar write a command line would run, as the scheduler argv the backstop reads (orion-agenda-change add is mapped to add --at). */
export declare function writesIn(command: string): string[][];
