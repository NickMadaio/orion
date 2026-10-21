import { type DayWord } from "./intent-time.js";
/** Every start he says, as the minutes each could be: "tonight at 7" -> [[1140]], "at 9" tomorrow -> [[540, 1260]] (either is his). */
export declare function statedStarts(message: string, ctx: {
    day: DayWord;
    now: number | null;
}): number[][];
/** The start a scheduler argv would write, per block: add --at, move --to, now --at, each day --plan's time. Empty: it picks the time itself. */
export declare function writtenStarts(argv: string[]): number[];
/** What to say instead of running these writes, or undefined when every time he said is a start one of them uses. */
export declare function timeMismatch(message: string, argvs: string[][], ctx: {
    day: DayWord;
    now: number | null;
}): string | undefined;
/** A shell command line's words, quotes kept together (the worker's exec of orion-reschedule). */
export declare function commandArgs(command: string): string[];
