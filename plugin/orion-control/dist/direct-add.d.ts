import type { AskContext, Day } from "./schedule-flow.js";
/** "until ten thirty" → "until 10:30", "at three o'clock" → "at 3:00", "by five" → "by 5". Only after a time word. */
export declare function spokenTimesToDigits(message: string): string;
/**
 * A clock he said, as minutes since midnight (may pass 1440 for "after midnight"). With am/pm or a 24-hour hour it is
 * exact; with neither it is the first time that clock shows strictly after `after` ("10:30" at 21:55 is 22:30, at 09:00 is 10:30).
 */
export declare function clockAfter(text: string, after: number): number | null;
/** The time he states in the evening that a form would write as the morning: "10:30" at 21:55 is 22:30, but only with no am/pm in his words. */
export declare function eveningTime(t: string | undefined, nowMinute: number, message: string): string | undefined;
export type DirectAdd = {
    args: string[];
    title: string;
    minutes: number;
    at: string;
} | {
    say: "ask" | "cannot";
    text: string;
};
/**
 * His whole request as one add from now, or what to say instead. undefined = not this shape (the form decides).
 * `day.now` must be set: this is for today only.
 */
export declare function parseDirectAdd(message: string, day: Day, ask?: AskContext): DirectAdd | undefined;
