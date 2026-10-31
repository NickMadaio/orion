/** "list everything on my calendar today with times", "show me my schedule", "read me my day": a read, not a change. */
export declare const asksDayRead: (message: string) => boolean;
/** The kind of block a habit question is about ("gym"), or null when it is not one. */
export declare function asksHabit(message: string): string | null;
/** The answer from what was tracked over the last 7 days: days it happened, days it was planned and missed. Read-only. */
export declare function habitAnswer(kind: string, stateDir: string, now: Date): string;
