import type { FlowResult } from "./schedule-flow.js";
import { type HealthLogFile } from "./health.js";
export type IntakeRead = {
    kind: "waterlog";
    bottles?: number;
    amountWord?: string;
} | {
    kind: "intake";
    what: "calories" | "protein";
    yesterday: boolean;
};
/** "had a big bottle of water" = 1 bottle; "drank 2 bottles" = 2; glasses / litres / "some water" ask; null when it is not a report of drinking. */
export declare function readWaterLog(message: string): IntakeRead | null;
export declare function readIntakeQuestion(message: string): IntakeRead | null;
export type OrionLog = (args: string[], healthLog: string) => Promise<{
    stdout: string;
    code: number;
}>;
/** The real orion-log, pointed at this state dir's health-log.json. */
export declare const liveOrionLog: OrionLog;
export declare function runIntake(read: IntakeRead, deps: {
    stateDir: string;
    now: Date;
    log?: OrionLog;
}): Promise<FlowResult>;
/** Calories / protein for the day, from the meals logged (and the day record's calorie total), in his words. */
export declare function answerIntake(read: Extract<IntakeRead, {
    kind: "intake";
}>, log: HealthLogFile, now: Date): FlowResult;
