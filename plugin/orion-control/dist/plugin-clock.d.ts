export declare const SANDBOX_TTL_MS: number;
export type ClockOpts = {
    dir?: string;
    realNow?: () => number;
};
/** The sandbox's `now` in ms when a fresh evaluation sandbox is active, else null. */
export declare function sandboxNowMs(opts?: ClockOpts): number | null;
export declare const pluginNowMs: (opts?: ClockOpts) => number;
export declare const pluginNow: (opts?: ClockOpts) => Date;
