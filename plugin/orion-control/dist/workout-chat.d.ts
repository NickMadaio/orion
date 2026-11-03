import type { WorkoutPendingView, WorkoutTurn } from "./workout-read.js";
export type WorkoutRun = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type WorkoutOutcome = {
    text: string;
    calls: string[];
    outputs: string[];
    logged?: {
        id: string;
    };
    asked?: boolean;
};
/** The real script with the plugin's state dir. Wired in by index.ts only. */
export declare const liveWorkoutRun: (stateDir?: string) => WorkoutRun;
/** The live follow-up in workout-pending.json, or undefined. */
export declare function readWorkoutPending(stateDir: string, now: Date): WorkoutPendingView | undefined;
/** Per chat: when a non-workout turn last happened, and the last workout logged here (for "undo"). */
export declare class WorkoutMemory {
    private others;
    private logs;
    otherTurn(key: string, nowMs: number): void;
    logged(key: string, id: string, nowMs: number): void;
    lastLogged(key: string): {
        id: string;
        at: number;
    } | undefined;
    forgetLog(key: string): void;
    /** The question is still what this chat is answering: nothing else was said since, and any label is the question's own line. */
    bound(key: string, pending: WorkoutPendingView, label?: string): boolean;
}
export type WorkoutDeps = {
    run: WorkoutRun;
    stateDir: string;
    now: Date;
};
/** Carries out one workout turn. Never throws; a failure is one honest sentence. */
export declare function runWorkoutTurn(turn: WorkoutTurn, deps: WorkoutDeps): Promise<WorkoutOutcome>;
