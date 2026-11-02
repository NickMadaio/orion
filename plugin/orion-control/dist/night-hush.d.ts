/** True from tonight's nudge time until the night ends at 05:00. */
export declare function pastNudgeTime(stateDir: string | undefined, now: Date): boolean;
export declare const NIGHT_FALLBACK = "It's late, so sleep wins. Anything skipped can wait for the morning.";
/** Late at night, drops sentences that order him to the gym or a plan task. Not when he asked about it himself. */
export declare function stripLateInstruction(reply: string, message: string): string;
/** The tone note's strict line without the gym order, for late nights. */
export declare const LATE_TONE_LINE = "It is past his wind-down time: never tell him to start gym, a side project or plan catch-up. Say sleep wins and a skipped plan waits for the morning.";
