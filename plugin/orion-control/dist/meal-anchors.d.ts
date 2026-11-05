export declare const ANCHOR_END: Array<[RegExp, number]>;
/** A plan with someone, or a place and a time: the scheduler books these at an exact time only (scripts/lib/life/live-day.mjs isSocial). */
export declare const SOCIAL_TITLE: RegExp;
/** The usual end of the meal he said "after", in minutes since midnight. */
export declare function mealEnd(message: string): number | undefined;
