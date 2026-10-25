import type { CalendarIntent } from "./calendar-intent.js";
import { type DayReplan } from "./day-replan.js";
import { type DirectAdd } from "./direct-add.js";
import { type DayPlanned } from "./day-plan.js";
import type { AskContext, Day } from "./schedule-flow.js";
export type IntentPlan = {
    kind: "run";
    argv: string[];
    replan?: Extract<DayReplan, {
        args: string[];
    }>;
    direct?: Extract<DirectAdd, {
        args: string[];
    }>;
    dayplan?: DayPlanned;
    title: string;
} | {
    kind: "say";
    say: "ask" | "cannot" | "plain";
    text: string;
};
/** The intent against the day: one scheduler argv, a line to say, or undefined (the normal path). */
export declare function planIntent(intent: CalendarIntent, day: Day, ctx: {
    message: string;
    askContext?: AskContext;
}): IntentPlan | undefined;
/** The intents code runs before the front desk is asked (local-routing.ts): the ones whose words alone decide the change. */
export declare const runsFirst: (intent: CalendarIntent) => boolean;
