export type AlarmDay = "today" | "tomorrow" | string;
export type AlarmReq = {
    kind: "set";
    time: string;
    day?: AlarmDay;
} | {
    kind: "off";
    day?: AlarmDay;
    days?: string[];
} | {
    kind: "shift";
    minutes: number;
} | {
    kind: "read";
};
/** HH:MM from "6:45", "645", "7am", "at 7", "0645". 3 AM to noon only; undefined otherwise. */
export declare function morningTime(m: string): string | undefined;
/** Minutes in "20 min", "half an hour", "an hour", "1h", "hour and a half", "two and a quarter hours"; undefined when none. */
export declare function minutesIn(m: string): number | undefined;
export type AlarmCtx = {
    recentAlarm?: boolean;
    hour?: number;
};
/** What he asked of his alarm, or undefined when it is not about it. */
export declare function readAlarm(message: string, ctx?: AlarmCtx): AlarmReq | undefined;
