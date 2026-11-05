export type NextWake = {
    at: Date;
    source: "plan" | "request";
};
export declare function nextWake(stateDir: string | undefined, now: Date): NextWake | undefined;
/** "today at 5:50 AM", "tomorrow at 5:50 AM", "Friday at 9:00 AM". */
export declare function spokenWake(at: Date, now: Date): string;
