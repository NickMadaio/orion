/*
 How long a turn may take before ORION stops being quiet about it (2026-10-20 incident, docs/audits/2026-10-20-reschedule-incident.md).

 On battery in Low Power Mode every local model call ran 3-10x slower than the 10-16 audit measured, and the stages were stacked end
 to end with no total: the 4B front desk (8 s abort), then the schedule flow's 9B form calls (22 s, then a 30 s abort) inside a host hook
 that is cut off at 15 s — so the host dropped ORION's slim worker prompt and ran the full 17.7k-token workspace prompt, 3 min 1 s for
 one call, 4 min 40 s for the turn. These numbers make the total explicit:

   desk        8 s normally; 2.5 s for 3 minutes after it failed (it is overloaded: do not wait 8 s again to be told so)
   flow        what is left of FLOW_BUDGET_MS since the turn began, never less than MIN_FLOW_MS; one form call is capped at FORM_CALL_MS and
               its correction round only starts with FORM_RETRY_MIN_MS to spare; nothing is WRITTEN after the deadline
   hook        before_prompt_build is registered with HOOK_TIMEOUT_MS (the host's default is 15 s, and past it the slim prompt is lost)
   slow turn   a change request that has used SLOW_TURN_MS and still has no code answer is answered with an honest line, in one tiny
               model call, instead of starting a tool loop that can run minutes
*/
export const DESK_TIMEOUT_MS = 8_000;
export const DESK_DEGRADED_TIMEOUT_MS = 2_500;
export const DESK_DEGRADED_WINDOW_MS = 3 * 60_000;
/** What code may spend on a turn before the worker starts (desk + flows), counted from the turn's start. */
export const FLOW_BUDGET_MS = 40_000;
export const MIN_FLOW_MS = 12_000;
export const FORM_CALL_MS = 25_000;
export const FORM_RETRY_MIN_MS = 12_000;
/** The host's cut-off for before_prompt_build, passed when the hook is registered (its default is 15 s). */
export const HOOK_TIMEOUT_MS = 55_000;
/** A change request that has taken this long before the worker starts is not given a multi-minute tool loop. */
export const SLOW_TURN_MS = 40_000;
export const SLOW_TURN_LINE = "I'm running slowly right now, so I didn't get to that and nothing on your day was changed. Say it again in a minute, or tell me exactly what to put where and when.";
export const SLOW_FLOW_LINE = "That took longer than I can wait on right now, so nothing on your day was changed. Say it again in a minute, or tell me exactly what to put where and when.";
/** The front desk's recent health: after a failure it is given a short timeout, because waiting the full one again only repeats the wait. */
export class DeskHealth {
    now;
    failedAt;
    constructor(now = Date.now) {
        this.now = now;
    }
    /** Records how a front-desk call ended (`fallback` is set when it failed or timed out). */
    record(decision) {
        if ("error" in decision || decision.fallback)
            this.failedAt = this.now();
        else
            this.failedAt = undefined;
    }
    degraded() { return this.failedAt !== undefined && this.now() - this.failedAt < DESK_DEGRADED_WINDOW_MS; }
    timeoutMs() { return this.degraded() ? DESK_DEGRADED_TIMEOUT_MS : DESK_TIMEOUT_MS; }
}
/** The instant after which the flow writes nothing: what is left of the turn's budget, but never less than MIN_FLOW_MS from now. */
export const flowDeadline = (turnStartedAt, now = Date.now()) => Math.max(turnStartedAt + FLOW_BUDGET_MS, now + MIN_FLOW_MS);
/** How long one 9B form call may take with this much time left (0 = do not start it). */
export const formCallMs = (leftMs) => (leftMs < 3_000 ? 0 : Math.min(FORM_CALL_MS, leftMs));
