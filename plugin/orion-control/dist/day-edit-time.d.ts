import { type Said } from "./intent-time.js";
export type Mode = "past" | "future";
/** Clock words to digits, and "in an hour" to a clock. `now` is minutes since midnight. */
export declare function naturalToDigits(text: string, now: number): string;
export declare const CLK: string;
/** "from 2 to 3" / "10-11pm" in a phrase: both clocks and the phrase with the range taken out. */
export declare function takeRange(text: string): {
    a: Said;
    b: Said;
    rest: string;
} | null;
/** "at 6" / "to 12" / "at 17:05": one clock after a time word, and the phrase without it. */
export declare function takeClock(text: string): {
    s: Said;
    rest: string;
} | null;
/** His words say early morning: a bare clock in them is the small hours, made exact. */
export declare function withEarlyCue<T extends Said>(s: T, text: string): T;
/** One clock: exact as said, else toward the sentence's direction (`near`: the old slot of what is being moved). */
export declare function pickClock(s: Said, now: number, mode: Mode, near?: number): number;
/** A range: the am/pm of one side carries to the other ("10-11pm" is 22:00-23:00, "11-1pm" is 11:00-13:00, "5-6" after the fact is 17:00-18:00). */
export declare function pickRange(a: Said, b: Said, now: number, mode: Mode): {
    from: number;
    to: number;
} | null;
