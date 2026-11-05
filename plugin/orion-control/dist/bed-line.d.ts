/** That evening's "asleep by" as minutes after midnight of its day (00:00-04:59 is after midnight, so 24:00+), or undefined. */
export declare function plannedBedtime(stateDir: string | undefined, date: Date): number | undefined;
/** One line for each block (end in minutes) that runs past that bedtime, or none. */
export declare function pastBedtimeNote(placed: ReadonlyArray<{
    title: string;
    end: number;
}>, bedtime: number | undefined): string | undefined;
