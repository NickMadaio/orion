/** His words say the small hours are meant. */
export declare const EARLY_CUE: RegExp;
/** First minute of the day he is plausibly up for (07:00). */
export declare const WAKING_FROM: number;
/** Keep the waking-hours readings of a bare clock; all of them when none is (a 3 AM-only clock like "2:30 in the night" is exact anyway). */
export declare function wakingOnly(candidates: number[]): number[];
