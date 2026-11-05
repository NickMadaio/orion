/** The honest line when every sentence was a claim. */
export declare const BEDTIME_UNSAVED = "I haven't changed your bedtime, so nothing was saved. Say it again and I'll set it.";
export declare const claimsBedtimeChange: (sentence: string) => boolean;
/** The draft without sentences that claim a bedtime change no tool made; unchanged when a sleep-plan write ran this turn. */
export declare function withoutUnverifiedBedtimeClaims(draft: string, tools: ReadonlyArray<{
    canonical: string;
}>, stateDir?: string): string;
