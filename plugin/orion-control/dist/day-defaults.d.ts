import type { Day, FlowResult } from "./schedule-flow.js";
import type { DeadlineRead } from "./deadline-read.js";
import type { ScriptRun } from "./reality.js";
type Claim = {
    title: string;
    at: string;
};
export type DayDefault = {
    kind: "lighten";
    tomorrow: boolean;
} | {
    kind: "with-person";
    who: string;
    what: string;
} | {
    kind: "before-class";
    title: string;
    minutes: number;
    named?: string;
    quick?: boolean;
} | {
    kind: "whats-now";
    claim?: Claim;
} | {
    kind: "ack-claim";
    claim: Claim;
};
export type DefaultDeps = {
    run: ScriptRun;
    readDay: (dateArgs: string[]) => Promise<Day | undefined>;
    now: Date;
    deadlines?: () => Promise<DeadlineRead | null | undefined>;
};
export type DefaultOutcome = {
    flow: FlowResult;
    writes: number;
    reads: string[];
};
/** A request with a safe default, or a "what now", or null (the turn goes on as before). outreach: the line ORION sent first, if any. */
export declare function readDayDefault(message: string, outreach?: string): DayDefault | null;
/** Carries out the default (or reads the day for "what now") and builds the reply from what the scheduler printed. */
export declare function runDayDefault(d: DayDefault, deps: DefaultDeps): Promise<DefaultOutcome>;
export {};
