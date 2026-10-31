export declare const SANDBOX_TTL_MS: number;
export type ClockOpts = {
    dir?: string;
    realNow?: () => number;
};
/** Forget cached answers (tests). */
export declare const resetClockCache: () => void;
/**
 * The sandbox's `now` in ms when a fresh evaluation sandbox is active, else null. Many calls per turn, so the stat/read
 * answer is kept for about a second per directory. An injected realNow (tests) always bypasses the cache.
 */
export declare function sandboxNowMs(opts?: ClockOpts): number | null;
export declare const pluginNowMs: (opts?: ClockOpts) => number;
export declare const pluginNow: (opts?: ClockOpts) => Date;
