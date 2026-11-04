export type PlanReasonItem = {
    title: string;
    rank: number;
    reason: string;
    why?: string[];
    start?: number;
    end?: number;
};
export type PlanReasons = {
    version: number;
    date: string;
    items: PlanReasonItem[];
};
/** The thing he is asking about ("" for "why is that first"), or null when this is not a "why is it first" question. */
export declare function whyFirstAsk(message: string): string | null;
/** Today's reasons, or null when there are none or they are about another day. */
export declare function readPlanReasons(stateDir: string, today: string): PlanReasons | null;
/** The answer in his plan's own words, or null when the plan has no such to-do. */
export declare function whyFirstAnswer(subject: string, reasons: PlanReasons | null): string | null;
