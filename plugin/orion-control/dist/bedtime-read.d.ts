export type BedChange = {
    time: string;
    scope: "tonight" | "always";
} | {
    shift: number;
    scope: "tonight" | "always";
}
/** "go back to normal bedtime": the exact standing bedtime (bedFixed) and any tonight override are cleared. */
 | {
    reset: true;
    scope: "always";
};
/** The bedtime change in his message, or undefined. */
export declare function readBedtimeChange(message: string): BedChange | undefined;
/**
 * A bedtime clause and an alarm clause in one message, in either order: the bedtime change and the alarm clause's own text, or undefined.
 * "going to bed at 11:30, set an alarm for 7" and "wake me at 7 tomorrow and bedtime tonight is midnight" (w20 r5, gate 3 #103: the second dropped the bedtime).
 */
export declare function readBedtimeWithAlarm(message: string): {
    change: BedChange;
    alarmText: string;
} | undefined;
