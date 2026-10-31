import type { Day, FlowResult } from "./schedule-flow.js";
import type { DeadlineRead } from "./deadline-read.js";
import type { ScriptRun } from "./reality.js";
export type LightenKind = "tired" | "sick" | "slept" | "stressed";
export type LightenRead = {
    kind: LightenKind;
    doIt: boolean;
    rank: boolean;
    nap?: {
        minutes: number;
        at?: string;
        afterClass?: boolean;
    };
    cut: string[];
};
/** One scheduler call and how it is said once it worked. */
export type LightenStep = {
    args: string[];
    said: string;
};
/** What a "yes" to the proposal runs: scheduler steps, or a focus session start (said as his words for the session flow). */
export type LightenPending = {
    steps: LightenStep[];
} | {
    session: string;
};
export type LightenPlan = {
    text: string;
    steps: LightenStep[];
    pending?: LightenPending;
};
/** A statement of being tired, sick, short of sleep or stressed, and what (if anything) he asked to be done about it. */
export declare function readLighten(message: string): LightenRead | null;
export declare const saysYes: (message: string) => boolean;
export declare const ampm: (t: string) => string;
/** The next deadlines in seven days, soonest first, as "the CS Midterm Thursday". */
export declare function soonDeadlines(read: DeadlineRead | null | undefined, now: Date, max?: number): Array<{
    title: string;
    when: string;
}>;
/** What to do (steps) or propose (pending), and what to say. Pure. */
export declare function planLighten(read: LightenRead, ctx: {
    day?: Day;
    deadlines?: DeadlineRead | null;
    now: Date;
}): LightenPlan;
/** Runs the steps in order and says what worked and everything else the scheduler changed to make it fit (REV2 finding 1). A failed step
 *  stops the rest. A step that wrote is one undo entry; an add whose own block did not fit is undone at once. */
export declare function runLighten(steps: LightenStep[], run: ScriptRun, context?: string): Promise<{
    flow: FlowResult;
    writes: number;
}>;
