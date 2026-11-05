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
/** A bedtime clause followed by an alarm clause: the bedtime change and the alarm clause's own text, or undefined. */
export declare function readBedtimeWithAlarm(message: string): {
    change: BedChange;
    alarmText: string;
} | undefined;
