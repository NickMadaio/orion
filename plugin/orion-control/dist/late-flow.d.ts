import { type FlowResult } from "./schedule-flow.js";
export declare const LATE_ASK = "How late \u2014 about how many minutes?";
export declare const LATE_TOO_SMALL = "I can only move things for 5 minutes or more \u2014 how late are you running?";
export type LateExec = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
/** "im running late" with no minutes named: a short statement, never a question or a longer plan. */
export declare function isLateWithoutMinutes(message: string): boolean;
/** His short answer to "how late?": "like 15 min", "15", "about 20 minutes", "an hour", "half an hour". Null if it is not one. */
export declare function lateMinutesAnswer(message: string): number | null;
export declare const isLateConfirm: (message: string) => boolean;
export declare const isBareYes: (message: string) => boolean;
/** "Nothing was moved — why." from the scheduler's own output (NOTHING WAS BOOKED / NOT BOOKED / NOTHING WAS CHANGED), or null if it wrote something. */
export declare function nothingMovedReply(outputs: string[], lead?: string): string | null;
/** `orion-reschedule late N`, and a reply from its own lines: what moved, or plainly that nothing did, and why. */
export declare function runLateFlow({ minutes, exec, undoTop }: {
    minutes: number;
    exec: LateExec;
    undoTop?: () => string | null;
}): Promise<FlowResult>;
/** The real late flow: scripts/orion-reschedule late N. Wired in by index.ts only. */
export declare const liveLateFlow: (minutes: number, undoTop: () => string | null) => Promise<FlowResult>;
