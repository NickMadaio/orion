export interface WeatherReport {
    place: string;
    /** One sentence, already phrased for speech. */
    summary: string;
    temperatureC: number;
    temperatureF: number;
    feelsLikeC: number;
    conditions: string;
    windKph: number;
    days: Array<{
        date: string;
        highC: number;
        lowC: number;
        highF: number;
        lowF: number;
        conditions: string;
        precipitationChance: number;
        /** Hours (from now, for today) with a 20%+ chance of rain: "3 PM" and the chance. */
        rainHours: Array<{
            at: string;
            chance: number;
            mm: number;
        }>;
    }>;
}
/** "Rain likely 2 PM–5 PM (up to 70%)" / "No rain expected", for the summary. */
export declare function rainPhrase(hours: Array<{
    at: string;
    chance: number;
}>): string;
export declare function readWeather(options: {
    location: string;
    days?: number;
}): Promise<WeatherReport>;
export declare function readClock(timezone?: string): {
    iso: string;
    spoken: string;
    timezone: string;
};
/**
 * How the machine itself is doing.
 *
 * Every one of these is a plain read of a system counter — nothing here can
 * change a setting. `pmset -g batt` rather than a settings API for exactly that
 * reason: there is no write form of it to get wrong.
 */
export declare function readSystemStatus(): Promise<{
    batteryPercent?: number;
    batteryState?: string;
    diskFreeGb?: number;
    diskTotalGb?: number;
    memoryPressure?: string;
    uptime: string;
    summary: string;
}>;
export interface Reminder {
    id: string;
    /** `timer` was set by duration, `alarm` by clock time. Only affects phrasing. */
    kind: "timer" | "alarm";
    label: string;
    /** Epoch milliseconds. The only field the firing side reads. */
    dueAt: number;
    createdAt: number;
}
export declare function remindersPath(configured?: string): string;
export declare function readReminders(file: string): Promise<Reminder[]>;
/**
 * Write via a temp file and rename.
 *
 * The Orion app polls this file continuously, so a plain write would let it
 * observe a half-written array and conclude every timer had been cancelled.
 * Rename is atomic within a filesystem, so the reader sees either the old file
 * or the new one and never a partial.
 */
export declare function writeReminders(file: string, reminders: Reminder[]): Promise<void>;
/** Spoken durations, so "an hour and a half" does not come back as 5400 seconds. */
export declare function describeDuration(seconds: number): string;
/**
 * Resolve "7:30", "7:30am", or an ISO timestamp to the next moment it names.
 *
 * A bare clock time that has already passed today means tomorrow — someone
 * setting an alarm for 7:30 at midnight means the morning that is coming, not
 * the one that is gone.
 */
/**
 * Pause Apple Music. Returns true if Music was running and responded.
 */
export declare function pauseAppleMusic(): Promise<boolean>;
export declare function resolveAlarmTime(at: string, now?: Date): number;
