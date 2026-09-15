export declare const AUTOMATION_ROOT: string;
/** Trigger shapes. Never a raw cron string; see the header. */
export type AutomationTrigger = {
    kind: "daily";
    atHour: number;
    atMinute: number;
} | {
    kind: "hourly";
    atMinute: number;
} | {
    kind: "weekly";
    weekday: number;
    atHour: number;
    atMinute: number;
};
/**
 * What an automation may do.
 *
 * Every entry is a command that already runs unattended on this machine and
 * already knows how to stay quiet -- `orion-standing` says only what changed,
 * `orion-focus check` speaks on a cooldown. Adding to this table is a
 * deliberate act with a reviewer; there is no entry that takes free text and
 * no shape that could hold one.
 */
export declare const AUTOMATION_ACTIONS: Readonly<Record<string, {
    argv: readonly string[];
    describe: string;
    risk: "low" | "medium";
}>>;
export type FailureBehavior = "stop" | "retry_once" | "report_and_continue";
export interface AutomationProposal {
    name: string;
    /** Nick's words, or Orion's summary of them. Shown at approval time. */
    intent: string;
    trigger: AutomationTrigger;
    conditions: {
        /** Local hours during which it must NOT speak. [start, end), 0-23. */
        quietHours?: readonly [number, number];
        /** Skip when Orion is in a focus session. */
        skipDuringFocus?: boolean;
    };
    action: keyof typeof AUTOMATION_ACTIONS;
    /**
     * Recorded, never granted. An automation runs at whatever strictness mode is
     * in force when it fires; this field says what it EXPECTS, so a mismatch is
     * visible rather than silently permissive.
     */
    permissions: {
        expectsMode: "contained" | "guarded" | "open" | "sovereign";
    };
    /** ISO date. Required — see the header on why. */
    expiresOn: string;
    riskLimits: {
        maxRunsPerDay: number;
        maxMessagesPerDay: number;
    };
    failureBehavior: FailureBehavior;
    proposedAt: string;
    /** Set once a person installs it. Orion cannot write this field. */
    installedAt?: string;
}
export declare const NAME_RE: RegExp;
/** The longest an automation may run before somebody has to want it again. */
export declare const MAX_AUTOMATION_DAYS = 180;
/**
 * Validate a proposal completely, returning every problem at once.
 *
 * All of them rather than the first, because a model that fixes one field per
 * round trip takes seven turns to write one automation, and the seventh is
 * where it starts inventing fields to make the errors stop.
 */
export declare function validateProposal(value: unknown): string[];
/** The trigger, in the words a person would use. */
export declare function describeTrigger(trigger: AutomationTrigger): string;
/** The cron expression, derived at INSTALL time and never accepted as input. */
export declare function cronExpression(trigger: AutomationTrigger): string;
export interface Simulation {
    /** Every moment it would have fired in the window. */
    fireCount: number;
    /** How many of those the conditions would have suppressed. */
    suppressedCount: number;
    /** Firings that would have spoken, after the daily message ceiling. */
    messageCount: number;
    windowDays: number;
    /** True when the ceiling, not the trigger, decided the message count. */
    cappedByRiskLimit: boolean;
    notes: string[];
}
/**
 * PHASE 58 — how often this would have fired, over a real window of clock time.
 *
 * Arithmetic against the calendar rather than a dry run, and deliberately so:
 * a dry run of `orion-daily` would roll up the day's memory, which is the
 * thing simulation exists to avoid doing.
 *
 * What it CANNOT answer is stated in `notes` rather than folded into a number.
 * Whether `orion-standing check` would actually have SAID anything depends on
 * what was in the calendar that morning, and this has no way to know — so it
 * reports the ceiling, calls it a ceiling, and says which part is unknown. A
 * simulation that quietly reports zero because it had no data is worse than
 * one that refuses to guess.
 */
export declare function simulate(proposal: AutomationProposal, options?: {
    windowDays?: number;
    from?: Date;
}): Simulation;
