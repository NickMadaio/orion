import type { FlowResult } from "./schedule-flow.js";
import type { Draft, SleepPending, SleepTurn } from "./sleep-plan-read.js";
export type SleepRun = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type SleepTool = {
    canonical: string;
    stdout: string;
    exit: number;
};
export type SleepOutcome = {
    flow: FlowResult;
    pending?: SleepPending;
    tools: SleepTool[];
};
type PlanDay = {
    date: string;
    weekday: string;
    wake: string;
    reason: string;
    firstClass: {
        title: string;
        at: string;
    } | null;
    evening: string;
    sleepBy: string;
    lockdownAt: string;
    wakeIso?: string;
    nudgeAtIso?: string;
    exception: {
        reason: string;
        until: string | null;
    } | null;
};
/** One interview per chat, for a few minutes; taken (and so cleared) by the next turn whatever it is. */
export declare class SleepPlanPending {
    static readonly TTL_MS: number;
    private readonly held;
    take(key: string, nowMs: number): SleepPending | undefined;
    set(key: string, pending: SleepPending | undefined, nowMs: number): void;
}
/** orion-sleepplan arguments for a draft. An alarm asked for outright keeps his other days (no --only); the interview replaces them. */
export declare function draftArgs(d: Draft): string[];
/** "Mon 6:00, Tue 9:00 (class 1:30), … — bed by 10pm the night before 6:00 days." Built from the CLI's days only. */
export declare function weekLine(days: PlanDay[]): string;
/** orion-checkin with fixed arguments: the one quiet check-back a grace promises. */
export type SleepCheckin = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export declare const GRACE_MIN = 10;
/** One turn of the sleep plan, end to end. `now` is the plugin clock (pluginNow); checkin books the grace's check-back. */
export declare function runSleepTurn(turn: SleepTurn, { run, now, checkin }: {
    run: SleepRun;
    now?: Date;
    checkin?: SleepCheckin;
}): Promise<SleepOutcome>;
/** The real script (no shell, fixed arguments), beside orion-wake (ORION_SCRIPTS_DIR for a replay). Wired in by index.ts only. */
export declare const liveSleepPlanRun: SleepRun;
export {};
