/** His words say the small hours are meant. "before class/work" is NOT one: it says nothing about which half of the day (the class could be 5 PM). */
export declare const EARLY_CUE: RegExp;
/** His words say the afternoon or evening: meals eaten then, "tonight", "this arvo". */
export declare const LATE_CUE: RegExp;
/** First minute of the day he is plausibly up for (07:00). */
export declare const WAKING_FROM: number;
/** Keep the waking-hours readings of a bare clock; all of them when none is (a 3 AM-only clock like "2:30 in the night" is exact anyway). */
export declare function wakingOnly(candidates: number[]): number[];
