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
/** The front desk's recent health: after a failure it is given a short timeout, because waiting the full one again only repeats the wait. */
export declare class DeskHealth {
    private readonly now;
    private failedAt;
    constructor(now?: () => number);
    /** Records how a front-desk call ended (`fallback` is set when it failed or timed out). */
    record(decision: {
        fallback?: string;
    } | {
        error: string;
    }): void;
    degraded(): boolean;
    timeoutMs(): number;
}
/** The instant after which the flow writes nothing: what is left of the turn's budget, but never less than MIN_FLOW_MS from now. */
export declare const flowDeadline: (turnStartedAt: number, now?: number) => number;
/** How long one 9B form call may take with this much time left (0 = do not start it). */
export declare const formCallMs: (leftMs: number) => number;
