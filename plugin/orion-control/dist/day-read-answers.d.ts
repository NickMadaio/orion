import { type Day } from "./schedule-flow.js";
/** The day as the worker and code read it: numbered blocks, then an "All day:" line (q004). */
export declare function dayRead(day: Day & {
    allDay?: string[];
}): string;
export declare const spokenTime: (hour: number, minute: number) => string;
export declare function noBlockReply(message: string, day: string, tomorrow: boolean): string | null;
/** "in about 8 h 17 min" / "in about 25 min" / "in about 2 h". */
export declare function spokenSpan(minutes: number): string;
/** The reply when the question names a kind of block that IS on the day (start, end, time left); null otherwise. */
export declare function presentBlockReply(message: string, day: string, tomorrow: boolean, nowMin: number): {
    text: string;
    memory: DayMemory;
} | null;
/** Short memory of the block the last day answer named, per session: what "and after that?" means. */
export type DayMemory = {
    tomorrow: boolean;
    startMinute: number;
    title: string;
    classOnly: boolean;
};
export declare const isNextClassQuestion: (message: string) => boolean;
export declare const isAfterThat: (message: string) => boolean;
/** "next class" / "and after that?" from the day read. `memory` is what the last answer named (after-that only). */
export declare function nextBlockReply(message: string, day: string, tomorrow: boolean, nowMin: number, memory?: DayMemory): {
    text: string;
    memory: DayMemory;
} | null;
/** Everything above in one call: the next-class / after-that answers, then a named block that is present. */
export declare function codeDayAnswer(message: string, day: string, tomorrow: boolean, nowMin: number, memory?: DayMemory): {
    text: string;
    memory: DayMemory;
} | null;
