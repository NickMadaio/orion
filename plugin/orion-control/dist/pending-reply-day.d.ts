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
/** The block on the day he named: the exact title, else one whose title holds every word he used ("marketing" → "MKTG2201 Marketing"). */
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
