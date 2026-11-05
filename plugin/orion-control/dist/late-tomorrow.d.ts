export declare const dateLabel: (d: Date) => string;
/** He said "tomorrow" while it is still the small hours of the night. */
export declare const isLateTomorrow: (message: string, now: Date) => boolean;
/** Today's day read, said as the day ahead of him. `dayText` is the numbered day list (day-read-answers.ts). */
export declare function lateTomorrowAnswer(dayText: string, now: Date): string;
