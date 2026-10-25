import type { Day, DayBlock } from "./schedule-flow.js";
/** One thing he said he will do: its name in his words, the end as he said it, a start he stated, and whether he goes home first. */
export type DayPlanItem = {
    name: string;
    endSaid: string;
    fromSaid?: string;
    home: boolean;
};
export type DayPlanAsk = {
    items: DayPlanItem[];
};
/** What the day planner writes for it: one `day --plan … --only` argv, and what each item is meant to be (for the honest reply). */
export type DayPlanned = {
    args: string[];
    items: Array<{
        title: string;
        start: number;
        end: number;
        home: boolean;
    }>;
    cleared: DayBlock[];
    anchorsCleared: string[];
};
export type DayPlanResult = DayPlanned | {
    say: "ask" | "cannot";
    text: string;
};
/** "only doing two things today. X from now until 6pm. then home. once home Y until 12 am" as items, or undefined (not this shape). */
export declare function parseDayPlan(message: string): DayPlanAsk | undefined;
/** His whole-day plan against today: one argv, or the line that says why not. Today only (day.now set). */
export declare function planDayPlan(ask: DayPlanAsk, day: Day): DayPlanResult | undefined;
/**
 * What he is told, written by code from the day as it now reads (never from the model): each thing he asked for against what is on
 * his calendar. "Done" only when every one of them is exactly as he asked; otherwise what he asked, what is there, and how to undo it.
 */
export declare function dayPlanReply(after: Day | undefined, plan: DayPlanned, failure?: string): string;
