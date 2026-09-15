/*
 GOVERNED SELF-DEVELOPMENT -- when a job goes local, and when it must not.

 The job named it directly: "self propogation and coding tasks I don't need
 in a rush should go through a local model to save money". That is a routing
 rule, and the job also named the trap in the same breath -- "not
 time-sensitive" cannot be a vibe a caller asserts about its own work, because
 the caller with the least reason to be honest about urgency is the one
 asking to skip the queue. This file makes urgency, budget and system
 conditions properties of a JOB OBJECT and of a SYSTEM READING, each with a
 fixed vocabulary, so "is this actually not time-sensitive" is answered by a
 function over data rather than by trusting whoever filed the job.

 Nothing here decides WHAT Orion may do -- that is
 self-development-authority.ts, unconditionally, before this file's routing
 or budget ever runs. This file only decides local vs. cloud, and when to
 stop running at all, given a job already accepted.

 Extends Phase 67 (plugin/orion-control/src -- see `scripts/orion-budget`
 and PHASE_GATES.json's "67" entry) rather than duplicating it: orion-budget's
 ceilings are DAILY, PER-AUTOMATION and PER-REMOTE-SESSION, read from usage
 logged after the fact. This is PER-JOB, checked before and during a run that
 has not logged anything anywhere yet, which is a different moment in the same
 problem -- a governed self-development job should never be the thing
 orion-budget's day-level check discovers after the fact.
*/
export const JOB_URGENCIES = ["routine", "time_sensitive"];
/** A deadline inside this window of "now" is treated as urgent even when the
 * job was filed as routine. Two hours: long enough that filing a job first
 * thing and expecting it done by lunch does not spend its whole life urgent,
 * short enough that "not time-sensitive" cannot be used to sit on something
 * due imminently. */
export const URGENT_WINDOW_MS = 2 * 60 * 60 * 1000;
/**
 * Local unless one of three things is true: the job already failed local
 * review once, the job is declared time-sensitive, or an attached deadline
 * has entered the urgent window. Each branch is independently testable and
 * none of them is "ask the model if it feels urgent".
 */
export function routeJob(job, now) {
    if (job.failedLocalReview) {
        return {
            route: "cloud",
            reason: "this job already failed local review once; it does not get a second local attempt",
        };
    }
    if (job.urgency === "time_sensitive") {
        return { route: "cloud", reason: "job is declared time_sensitive" };
    }
    if (job.deadlineAt !== undefined) {
        const deadlineMs = Date.parse(job.deadlineAt);
        if (Number.isNaN(deadlineMs)) {
            throw new Error(`deadlineAt "${job.deadlineAt}" is not a parseable ISO 8601 timestamp`);
        }
        const remainingMs = deadlineMs - now.getTime();
        if (remainingMs <= URGENT_WINDOW_MS) {
            const minutes = Math.round(remainingMs / 60_000);
            return {
                route: "cloud",
                reason: `deadline is ${minutes} minute(s) away, inside the ${URGENT_WINDOW_MS / 60_000}-minute urgent window`,
            };
        }
    }
    return {
        route: "local",
        reason: "routine, no local-review failure on record, no deadline inside the urgent window",
    };
}
/**
 * Deliberately small next to orion-budget's DAILY ceilings (5,000,000 tokens,
 * 400 calls): a single governed self-development job is one slice of a day,
 * not the day itself, and a runaway single job should hit its own ceiling
 * long before it could threaten the daily one.
 */
export const DEFAULT_BUDGET_ENVELOPE = {
    maxDurationMs: 30 * 60 * 1000,
    maxModelCalls: 40,
    maxTokens: 400_000,
};
/** Checked against usage measured SO FAR, meant to be called repeatedly
 * during a run rather than only once at the end -- a budget nobody consults
 * until the job is already over cannot stop anything. */
export function checkBudget(usage, envelope = DEFAULT_BUDGET_ENVELOPE) {
    const exceeded = [];
    if (usage.elapsedMs > envelope.maxDurationMs)
        exceeded.push("duration");
    if (usage.modelCalls > envelope.maxModelCalls)
        exceeded.push("modelCalls");
    if (usage.tokensUsed > envelope.maxTokens)
        exceeded.push("tokens");
    return { withinBudget: exceeded.length === 0, exceeded };
}
export const THERMAL_PRESSURES = ["nominal", "fair", "serious", "critical"];
/** Below this, unplugged, a background coding job is not worth the charge cycle. */
export const MIN_BATTERY_PERCENT_UNPLUGGED = 30;
/**
 * Every reason that applies, not just the first -- a job resuming after a
 * pause should see the whole picture rather than clearing one condition and
 * immediately re-hitting the next one it never knew was also true.
 */
export function shouldPause(state) {
    const reasons = [];
    if (state.quietHoursActive) {
        reasons.push("quiet hours are active");
    }
    if (state.thermalPressure === "serious" || state.thermalPressure === "critical") {
        reasons.push(`thermal pressure is ${state.thermalPressure}`);
    }
    if (!state.isCharging && state.batteryPercent < MIN_BATTERY_PERCENT_UNPLUGGED) {
        reasons.push(`battery is ${state.batteryPercent}% and not charging (floor is ${MIN_BATTERY_PERCENT_UNPLUGGED}%)`);
    }
    return { paused: reasons.length > 0, reasons };
}
