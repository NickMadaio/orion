import type { DayBlock } from "./schedule-flow.js";
/** His words name this event: a word of its title, its course code (or the code's letters: "marketing" for MKTG2201). */
export declare function namesOwnEvent(message: string, block: DayBlock): boolean;
/**
 * He is moving THIS event: he names it, names no other block of the day ("move gym to 4 after marketing" moves the gym, never the
 * class), and gives its new time.
 */
export declare function movesThisOne(message: string, block: DayBlock, others?: readonly DayBlock[]): boolean;
/** The new start he gave for that event ("HH:MM"), the hour read as the one nearer the event's own start; else undefined. */
export declare function newStartFor(message: string, block: DayBlock): string | undefined;
export declare const asksToShiftAfter: (message: string) => boolean;
/**
 * The scheduler's "Nothing needed to move: Gym 17:00 still fits after …" (an overrun or late the day's slack absorbed): what still
 * fits, `null` when nothing of his comes after, undefined when the run said something else.
 */
export declare function nothingToMove(stdout: string): {
    title: string;
    at: string;
} | null | undefined;
/**
 * The form read a named event's new time as an overrun ("move my MKTG2201 class from 1:30 to 2pm, its running late"): when he
 * names it and gives the new start, it is a move. Undefined when his words do not say that.
 */
export declare function overrunIsMove(message: string, block: DayBlock, others?: readonly DayBlock[]): string[] | undefined;
