/** "until ten thirty" -> "until 10:30", "at three o'clock" -> "at 3:00", "by five" -> "by 5". Only after a time word. */
export declare function spokenTimesToDigits(message: string): string;
export declare const toMin: (t: string) => number;
export declare const hhmm: (n: number) => string;
export declare const ceil5: (n: number) => number;
/** 22:30 -> "10:30 PM". */
export declare const ampm: (m: number) => string;
/** 20:15-21:45 -> "8:15–9:45 PM". */
export declare const span: (a: number, b: number) => string;
/**
 * A clock he said, as minutes since midnight (may pass 1440 for "after midnight"). With am/pm or a 24-hour hour it is
 * exact; with neither it is the first time that clock shows strictly after `after` ("10:30" at 21:55 is 22:30, at 09:00 is 10:30).
 */
export declare function clockAfter(text: string, after: number): number | null;
/** A clock as he said it: "5", "5pm", "10:30", "17:00", "noon". */
export type Said = {
    h: number;
    m: number;
    ap?: "a" | "p";
    exact: boolean;
};
export declare const CLOCK: string;
export declare function parseClock(text: string): Said | null;
export type DayWord = "today" | "tomorrow";
/** The end of today: a block "until midnight" ends at 24:00 (the scheduler takes `24:00` as an end, never as a start). */
export declare const MIDNIGHT_END = 1440;
/** part: "morning" / "evening" when he said so ("tomorrow morning", "tonight"). */
export type ClockContext = {
    day: DayWord;
    now: number | null;
    part?: "morning" | "evening";
};
export type Resolved = {
    at: number;
} | {
    passed: number;
} | {
    ambiguous: [number, number];
};
/** When something he wants to START at that clock starts. */
export declare function resolveStart(said: Said, ctx: ClockContext): Resolved;
/** When something that starts at `start` ENDS at that clock: the first time it shows after the start, the same day. */
export type EndResolved = Resolved | {
    before: number;
} | {
    pastMidnight: number;
};
export declare function resolveEnd(said: Said, start: number, ctx: ClockContext): EndResolved;
export declare const LENGTH: RegExp;
/** The length a phrase gives, and the phrase with it taken out. */
export declare function takeLength(text: string): {
    minutes?: number;
    rest: string;
};
