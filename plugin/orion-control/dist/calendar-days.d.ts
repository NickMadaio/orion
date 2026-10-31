import { type CalDeps, type CalOutcome } from "./calendar-resolve.js";
type Scope = "each" | "sat" | "sun";
export type PlanItem = {
    title: string;
    minutes: number;
    scope: Scope;
    kind: "gym" | "study" | "rest" | "other";
    stated: boolean;
};
export type MultiDayPlan = {
    kind: "multi-day";
    span: "weekend" | "tomorrow";
    items: PlanItem[];
    free: Array<{
        scope: Scope;
        part: "morning" | "afternoon" | "evening";
    }>;
    listed: boolean;
    assumed: string[];
};
/** A plan for the weekend or tomorrow, or null. */
export declare function readMultiDay(message: string): MultiDayPlan | null;
type Target = {
    date: string;
    name: string;
    scope: Scope | "other";
    today: boolean;
};
/** The days the plan covers, from now. */
export declare function planDays(range: MultiDayPlan["span"], now: Date): Target[];
/** The first free start at or after `from` for `minutes`, inside the day and outside the windows he wants free. */
export declare function firstFit(busy: Array<[number, number]>, minutes: number, from: number, lo: number, hi?: number): number | undefined;
/** Plans each requested day; the reply lists each day as its calendar now reads. */
export declare function runMultiDay(plan: MultiDayPlan, deps: CalDeps): Promise<CalOutcome>;
export {};
