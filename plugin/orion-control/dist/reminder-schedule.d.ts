export type Repeat = {
    days: number[];
    time: string;
};
export declare const daysOf: (group: "daily" | "weekdays" | "weekends") => number[];
/** The first moment strictly after `after` on one of the days at the time; null when the repeat is not valid. */
export declare function nextOccurrence(repeat: Repeat, after: Date | number): number | null;
export declare const clock12: (time: string) => string;
/** "every Monday at 9:00 AM", "every weekday at 8:00 AM", "every day at 9:30 PM". */
export declare function describeRepeat(repeat: Repeat): string;
