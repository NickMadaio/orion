import type { Day, DayBlock, FlowResult } from "./schedule-flow.js";
export declare const BUFFER = 5;
export declare const DAY_END: number;
export declare const toMin: (t: string) => number;
/** "7:45 PM". */
export declare const h12: (min: number) => string;
/** "7:45pm" / "8am", the form the calendar intent reads. */
export declare const cmdTime: (min: number) => string;
export declare const nowMinOf: (d: Date) => number;
/** Before 5 AM "tomorrow" is the day he wakes into, which is today's date (schedule-flow LATE_NIGHT_UNTIL). */
export declare const LATE_NIGHT = 5;
export declare const wakeDayIsToday: (now: Date) => boolean;
export type Which = "today" | "tomorrow";
export declare const dayArgs: (which: Which, now: Date) => string[];
export declare const dayWord: (which: Which, now: Date) => string;
/**
 A clock time he said, on the day it is for (REV4 8). "at 8" said after 8 AM today is 8 PM; a time with am/pm is kept as said. Undefined
 when that time has already gone today: nothing is placed in elapsed time. Another day's time is kept as said.
*/
export declare function clockOn(at: number, meridiem: boolean | undefined, which: Which, now: Date): number | undefined;
/** After a write: where the block called `title` now starts on the day, read back; undefined when no such block sits near `asked`. */
export declare function placedAt(day: Day | undefined, title: string, asked: number): number | undefined;
/** A class or a plan with people (the scheduler marks both fixed); a title "with <someone>" counts when there is no block to read. */
export declare const isProtected: (title: string, block?: DayBlock) => boolean;
/** The block on the day he named: the exact title, else the one block-names.ts finds ("marketing" → "MKTG2201"), else any shared word. */
export declare function blockNamed(day: Day | undefined, name: string): DayBlock | undefined;
/** The first start in [from, to) where `minutes` fit with his five-minute buffer around every other block; undefined when none. */
export declare function freeSlot(day: Day | undefined, minutes: number, from: number, to: number, skip?: DayBlock): number | undefined;
/** The fixed block that anchors the day he wakes into (his first class), for "CS2100 at 9:00 AM stays". */
export declare const firstFixed: (day: Day | undefined) => DayBlock | undefined;
/** What is on now and what comes next, from the real day. */
export declare function nowAndNext(day: Day | undefined, nowMin: number): {
    current?: DayBlock;
    next?: DayBlock;
};
/** A title the calendar intent reads as a name: no course numbers, nothing but words ("MKTG2201" → "MKTG"). */
export declare const safeTitle: (s: string, fallback: string) => string;
export declare const addCommand: (title: string, minutes: number, which: Which, start: number, now: Date) => string;
export declare const moveCommand: (title: string, which: Which, start: number, now: Date) => string;
/** What the scheduler said, as his reply: its own built reply, its lines read out, or its refusal. */
export declare function flowText(flow: FlowResult | undefined): string | undefined;
/** Whether the scheduler wrote (a "done" that is not an unknown outcome). */
export declare const flowWrote: (flow: FlowResult | undefined) => flow is Extract<FlowResult, {
    outcome: "done";
}>;
