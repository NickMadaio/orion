export declare const DESK_TIMEOUT_MS = 8000;
export declare const DESK_DEGRADED_TIMEOUT_MS = 2500;
export declare const DESK_DEGRADED_WINDOW_MS: number;
/** What code may spend on a turn before the worker starts (desk + flows), counted from the turn's start. */
export declare const FLOW_BUDGET_MS = 40000;
export declare const MIN_FLOW_MS = 12000;
export declare const FORM_CALL_MS = 25000;
export declare const FORM_RETRY_MIN_MS = 12000;
/** The host's cut-off for before_prompt_build, passed when the hook is registered (its default is 15 s). */
export declare const HOOK_TIMEOUT_MS = 55000;
/** A change request that has taken this long before the worker starts is not given a multi-minute tool loop. */
export declare const SLOW_TURN_MS = 40000;
export declare const SLOW_TURN_LINE = "I'm running slowly right now, so I didn't get to that and nothing on your day was changed. Say it again in a minute, or tell me exactly what to put where and when.";
export declare const SLOW_FLOW_LINE = "That took longer than I can wait on right now, so nothing on your day was changed. Say it again in a minute, or tell me exactly what to put where and when.";
/** The hook gave up after a write had started: the write is NOT stopped (a half-applied day is worse than a late one); he hears how it ended with his next message. */
export declare const SLOW_FLOW_MAYBE_WROTE_LINE = "That's taking longer than I can wait on. The change to your day is already being made and I'm letting it finish, so I'll tell you how it went with your next message. If your calendar looks wrong, say \"undo\" and I'll put the last change back.";
/** What he is told when the change that was left to finish did not report. */
export declare const LATE_UNKNOWN_LINE = "The change I was making stopped before it reported back, so check your calendar. Say \"undo\" if it looks wrong and I'll put the last change back.";
/**
 * The front desk's recent health. After a failure it is "degraded": calls get the short timeout (waiting 8 s again only repeats the wait), except one probe
 * per DESK_DEGRADED_WINDOW_MS with the normal budget. A short call that times out proves nothing, so only a probe can end (or extend) the degradation.
 */
export declare class DeskHealth {
    private readonly now;
    private degradedSince;
    private lastProbeAt;
    constructor(now?: () => number);
    degraded(): boolean;
    /** The timeout for the next call, and whether it is the probe. Call once per desk call. */
    begin(): {
        timeoutMs: number;
        probe: boolean;
    };
    /** Records how a call ended (`fallback` / `error` when it failed or timed out). */
    record(decision: {
        fallback?: string;
    } | {
        error: string;
    }, call?: {
        probe: boolean;
    }): void;
}
/** The instant after which the flow writes nothing: what is left of the turn's budget, but never less than MIN_FLOW_MS from now. */
export declare const flowDeadline: (turnStartedAt: number, now?: number) => number;
/** How long one 9B form call may take with this much time left (0 = do not start it). */
export declare const formCallMs: (leftMs: number) => number;
