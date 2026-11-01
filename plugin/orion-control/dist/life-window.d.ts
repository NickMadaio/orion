/** His bedtime in minutes after midnight (midnight when unset or unreadable). */
export declare function bedtimeMin(stateDir: string | undefined): number;
/** The latest a planned block may end today: bedtime less wind-down, on the evening's clock (00:30 bedtime is 24:00 at most). */
export declare function dayEndFor(stateDir: string | undefined): number;
