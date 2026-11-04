import type { FlowResult } from "./schedule-flow.js";
import { type WaterGoalRead } from "./water-goal.js";
export type MealRead = {
    kind: "meal";
    meal: string;
    title: string;
    notes: string;
    at: Date;
};
export type GymRead = {
    kind: "gym";
    scope: "week" | "last7" | "recent";
};
export type BedtimeRead = {
    kind: "bedtime";
    read: boolean;
    time?: string;
    week: boolean;
};
export type HealthRead = MealRead | GymRead | BedtimeRead | WaterGoalRead;
export declare function readMeal(message: string, now: Date): MealRead | null;
export declare function readGym(message: string): GymRead | null;
export declare function readBedtime(message: string): BedtimeRead | null;
/** The first health phrase in his message, or null. Pure. */
export declare function readHealthIntent(message: string, now: Date): HealthRead | null;
export declare function runMeal(read: MealRead, deps: {
    stateDir: string;
    now: Date;
}): Promise<FlowResult>;
/** Gym days from every record: health-log workouts, plan history (started), logged.jsonl. Missed = planned with no start and no other record. */
export declare function gymHistory(stateDir: string): Promise<{
    done: Set<string>;
    planned: Set<string>;
    workouts: Array<{
        day: string;
        title: string;
        exercises: string[];
    }>;
}>;
export declare function runGym(read: GymRead, deps: {
    stateDir: string;
    now: Date;
}): Promise<FlowResult>;
/** 30 minutes earlier than now, never into the afternoon (a bedtime before 10 PM is his to name). */
export declare function earlierBedtime(current: string): string;
export declare function runBedtime(read: BedtimeRead, deps: {
    stateDir: string;
}): Promise<FlowResult>;
/** "Your health log has 4.5 h of sleep and 31% recovery for last night." from the newest record of today or yesterday; "" when none. */
export declare function sleepLine(stateDir: string, now: Date): Promise<string>;
/** Runs one health read. */
export declare function runHealthIntent(read: HealthRead, deps: {
    stateDir: string;
    now: Date;
}): Promise<FlowResult>;
