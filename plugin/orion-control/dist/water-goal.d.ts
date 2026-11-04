import type { FlowResult } from "./schedule-flow.js";
export type WaterGoalRead = {
    kind: "water";
    read: boolean;
    bottles?: number;
};
export declare const WATER_GOAL_DEFAULT = 9;
/** What he said about the goal, or null. Pure. */
export declare function readWaterGoal(message: string): WaterGoalRead | null;
export declare function runWaterGoal(read: WaterGoalRead, deps: {
    stateDir: string;
    now: Date;
}): Promise<FlowResult>;
