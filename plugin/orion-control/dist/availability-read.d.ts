import type { Day } from "./schedule-flow.js";
type Part = "morning" | "afternoon" | "evening" | "night";
export type AvailabilityAsk = {
    dateArgs: string[];
    label: string;
    day: string;
    part?: Part;
    today: boolean;
};
/** Does this message ask whether a named day / part of day is free, or what is on it? Undefined for anything else. */
export declare function readAvailability(message: string, now: Date): AvailabilityAsk | undefined;
/** What he hears: free, free apart from ORION's own blocks, or what is on it. Built from the blocks the read returned and nothing else. */
export declare function availabilityReply(ask: AvailabilityAsk, day: Day, now: Date): string;
/** The whole route: read the named day, answer from it. Read failing is said as a failed read, never as "I don't have your calendar". */
export declare function answerAvailability(message: string, now: Date, readDay: (dateArgs: string[]) => Promise<Day | undefined>): Promise<string | undefined>;
export {};
