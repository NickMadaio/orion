import type { Day } from "./schedule-flow.js";
import type { DeadlineRead } from "./deadline-read.js";
export type Cancelled = {
    title: string;
    start: string;
    end: string;
};
export type FreedPlan = {
    title: string;
    minutes: number;
    start: string;
    why: "gym" | "deadline" | "study" | "side_project";
};
/** The classes `orion-reschedule classes-off` printed as cancelled, with their spans. */
export declare function cancelledFrom(stdout: string): Cancelled[];
/** What goes where in the freed time, in priority order. Pure. */
export declare function planFreedTime(ctx: {
    day: Day;
    cancelled: Cancelled[];
    nowMin: number;
    deadlines: string[];
}): FreedPlan[];
/** The one scheduler call that books them. */
export declare const freedArgs: (plans: FreedPlan[]) => string[];
/** What he hears about the freed time: read back from the day after the write, the assumption made, gym, and every other change. */
export declare function freedReply(plans: FreedPlan[], ctx: {
    before: Day;
    after?: Day;
    outputs: string[];
    deadlines: string[];
}): string;
type Run = (script: "orion-reschedule", args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type FreedDeps = {
    day: Day;
    offStdout: string;
    now: Date;
    run: Run;
    readDeadlines?: () => Promise<DeadlineRead | null | undefined>;
};
/** Plans and books the freed time, and says it. Nothing to plan (the time is past) or a refused write says so plainly. */
export declare function fillFreedTime(deps: FreedDeps): Promise<{
    text: string;
    calls: string[];
    outputs: string[];
    writes: number;
}>;
export {};
