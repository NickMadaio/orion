import type { Day } from "./schedule-flow.js";
/** What the scheduler hands code about the day it plans (`show --json`'s `plan`): the trip home, the gap between blocks, the daily anchors. */
export type DayPlanFacts = {
    commuteMinutes: number;
    bufferMinutes: number;
    anchors: Array<{
        title: string;
        minutes: number;
    }>;
};
/** explicit: he asked to redo the day ("reschedule", "replan", "move everything"), so a name code cannot place is asked about, not handed to the form. */
export type ReplanAsk = {
    order: string[];
    anchor?: string;
    home: boolean;
    explicit: boolean;
};
export declare const startsAsRequest: (text: string) => boolean;
/** The order and the anchor in his words, or undefined when this is not a reschedule with an order. */
export declare function parseReplanRequest(message: string): ReplanAsk | undefined;
type Item = {
    title: string;
    minutes: number;
};
/** pushed: where he asked for the first thing to go, and what is in the way, when it could not go there. */
export type DayReplan = {
    args: string[];
    start: string;
    items: Item[];
    via: string;
    pushed?: {
        wanted: string;
        because: string;
    };
} | {
    say: "ask" | "cannot";
    text: string;
};
/** His reschedule with an order as one `orion-reschedule day` call, what to say instead, or undefined (not this shape: the form decides). */
export declare function planDayReplan(message: string, day: Day): DayReplan | undefined;
/** What he is told: the movable blocks from his first thing onward, in order, with times, read back from the day as it now stands, then what did not go as asked. */
export declare function replanReply(day: Day, plan: Extract<DayReplan, {
    args: string[];
}>, outputs?: string[]): string;
export {};
