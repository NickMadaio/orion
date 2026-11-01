import type { Day, FlowResult } from "./schedule-flow.js";
import { type NamedWrite } from "./calendar-resolve.js";
import { type MultiDayPlan } from "./calendar-days.js";
export type Clause = {
    verb: "remove";
    names: string[];
} | {
    verb: "add";
    name: string;
    minutes?: number;
    at?: string;
    after?: string;
    fixed?: boolean;
    until?: string;
} | {
    verb: "move-after";
    name: string;
    after?: string;
};
export type DayRequest = DayRequestMore | {
    kind: "clauses";
    clauses: Clause[];
    ill: boolean;
    keep?: string;
    gymKept?: boolean;
} | {
    kind: "deadline";
    title: string;
    day: string;
    at?: string;
    book: boolean;
    sessions: number;
    minutes: number;
} | {
    kind: "to-tomorrow";
    name: string;
    at?: string;
    part?: "morning" | "afternoon" | "evening";
    minutes?: number;
    defer: boolean;
} | {
    kind: "then";
    activity: string;
    minutes: number;
    next: string;
} | {
    kind: "clear-owned";
    scope: "today" | "tomorrow" | "week";
}
/** "can we do gym later, like after dinner": a move with a natural default, said back as the assumption. */
 | {
    kind: "vague-move";
    name: string;
    when: string;
}
/** "moved to 8pm tonight" with no name: the block under way, else the next one of his. */
 | {
    kind: "unnamed-move";
    at: string;
}
/** "i skipped marketing, put 1 hour of catch up on it tomorrow evening" */
 | {
    kind: "catch-up";
    what: string;
    minutes: number;
    minutesSaid?: true;
    day: "today" | "tomorrow";
    part?: "morning" | "afternoon" | "evening";
};
export type DayRequestMore = NamedWrite | MultiDayPlan;
export type RequestScript = (script: "orion-declare" | "orion-reschedule" | "orion-tasks", args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type RequestDeps = {
    run: RequestScript;
    readDay: () => Promise<Day | undefined>;
    readDayOn?: (dateArgs: string[]) => Promise<Day | undefined>;
    now: Date;
    slipsOf?: (what: string) => number;
    /** Wave 6: ORION's state dir, for how often a deferred plan already slid (slip-history.ts). */
    stateDir?: string;
};
export type RequestOutcome = {
    flow: FlowResult;
    facts: string[];
    writes: number;
};
/** A calendar request code carries out itself, or null (the turn goes on as usual). */
export declare function readDayRequest(message: string, now?: Date): DayRequest | null;
/** The scheduler's reason for a refusal, in his words: its advice to ORION ("— if he meant another day, run again with --date …"), dates,
 *  option names and script names are cut, so no tool internals reach him. Undefined when there is nothing safe to say. */
export declare function whyNot(stdout: string): string | undefined;
/** Carries a day request out with fixed scheduler calls; the reply is built from what the scripts printed. */
export declare function runDayRequest(r: DayRequest, deps: RequestDeps): Promise<RequestOutcome>;
/** Today's date as orion-reschedule reads it, for a caller that needs a yesterday ("before 5 AM, last night is yesterday"). */
export declare const yesterdayOf: (now: Date) => string;
