export declare const JOB_URGENCIES: readonly ["routine", "time_sensitive"];
export type JobUrgency = (typeof JOB_URGENCIES)[number];
export interface SelfDevelopmentJob {
    readonly id: string;
    readonly description: string;
    readonly urgency: JobUrgency;
    /** ISO 8601. When the job was filed. */
    readonly requestedAt: string;
    /** ISO 8601, optional. A deadline turns "routine" urgent as it approaches --
     * see `URGENT_WINDOW_MS` -- rather than staying routine right up to the
     * moment it is already late. */
    readonly deadlineAt?: string;
    /** Set once a local pass has already been rejected or flagged for this job.
     * A job does not get a second local attempt; the whole point of "goes to
     * cloud on failure" is that the failure ends the local lane for that job,
     * not just that one call within it. */
    readonly failedLocalReview: boolean;
}
/** A deadline inside this window of "now" is treated as urgent even when the
 * job was filed as routine. Two hours: long enough that filing a job first
 * thing and expecting it done by lunch does not spend its whole life urgent,
 * short enough that "not time-sensitive" cannot be used to sit on something
 * due imminently. */
export declare const URGENT_WINDOW_MS: number;
export type RouteDecision = "local" | "cloud";
export interface RouteResult {
    readonly route: RouteDecision;
    readonly reason: string;
}
/**
 * Local unless one of three things is true: the job already failed local
 * review once, the job is declared time-sensitive, or an attached deadline
 * has entered the urgent window. Each branch is independently testable and
 * none of them is "ask the model if it feels urgent".
 */
export declare function routeJob(job: SelfDevelopmentJob, now: Date): RouteResult;
export interface SelfDevelopmentBudgetEnvelope {
    readonly maxDurationMs: number;
    readonly maxModelCalls: number;
    readonly maxTokens: number;
}
/**
 * Deliberately small next to orion-budget's DAILY ceilings (5,000,000 tokens,
 * 400 calls): a single governed self-development job is one slice of a day,
 * not the day itself, and a runaway single job should hit its own ceiling
 * long before it could threaten the daily one.
 */
export declare const DEFAULT_BUDGET_ENVELOPE: SelfDevelopmentBudgetEnvelope;
export interface SelfDevelopmentUsage {
    readonly elapsedMs: number;
    readonly modelCalls: number;
    readonly tokensUsed: number;
}
export type BudgetDimension = "duration" | "modelCalls" | "tokens";
export interface BudgetCheck {
    readonly withinBudget: boolean;
    readonly exceeded: readonly BudgetDimension[];
}
/** Checked against usage measured SO FAR, meant to be called repeatedly
 * during a run rather than only once at the end -- a budget nobody consults
 * until the job is already over cannot stop anything. */
export declare function checkBudget(usage: SelfDevelopmentUsage, envelope?: SelfDevelopmentBudgetEnvelope): BudgetCheck;
export declare const THERMAL_PRESSURES: readonly ["nominal", "fair", "serious", "critical"];
export type ThermalPressure = (typeof THERMAL_PRESSURES)[number];
export interface SystemState {
    readonly batteryPercent: number;
    readonly isCharging: boolean;
    readonly thermalPressure: ThermalPressure;
    readonly quietHoursActive: boolean;
}
/** Below this, unplugged, a background coding job is not worth the charge cycle. */
export declare const MIN_BATTERY_PERCENT_UNPLUGGED = 30;
export interface PauseDecision {
    readonly paused: boolean;
    readonly reasons: readonly string[];
}
/**
 * Every reason that applies, not just the first -- a job resuming after a
 * pause should see the whole picture rather than clearing one condition and
 * immediately re-hitting the next one it never knew was also true.
 */
export declare function shouldPause(state: SystemState): PauseDecision;
