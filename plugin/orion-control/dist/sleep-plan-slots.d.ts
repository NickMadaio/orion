/** Wake days as orion-sleepplan reads them: mon..sun, "weekdays", "weekends", "all", "gym". */
export type DayWake = {
    days: string[];
    wake: string;
};
export type Draft = {
    wake?: string;
    days?: string[];
    rest?: string;
    also?: DayWake[];
    lead?: number | null;
    sleep?: number;
    /** A standing alarm he asked for outright ("set a 6am alarm every mon wed thu"): saved without the interview. */
    direct?: boolean;
};
export declare const clean: (m: string) => string;
export declare const num: (raw: string) => number;
export declare const AMOUNT: string;
export declare const LEAD: RegExp;
export declare function leadMinutes(m: RegExpMatchArray, bareIsHours: boolean): number | undefined;
/** A wake-up time as HH:MM: 4 AM to noon, no meridiem means the morning. */
export declare function wakeTime(h: number, m: number, mer?: string): string | undefined;
/** Everything a message says about the plan. Pure. */
export declare function slotsOf(message: string): Draft;
