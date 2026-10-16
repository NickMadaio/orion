import { type Day } from "./schedule-flow.js";
/** The day as the worker and code read it: numbered blocks, then an "All day:" line (q004). */
export declare function dayRead(day: Day & {
    allDay?: string[];
}): string;
export declare const spokenTime: (hour: number, minute: number) => string;
/** The reply when the question names a kind of block and none is on the day; null when one is, or none is named. */
export declare function noBlockReply(message: string, day: string, tomorrow: boolean): string | null;
