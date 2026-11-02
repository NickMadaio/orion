import type { FoodPendingView, FoodTurn } from "./food-read.js";
export type FoodRun = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type FoodOutcome = {
    text: string;
    calls: string[];
    outputs: string[];
    logged?: {
        id: string;
    };
};
export declare const PHOTO_LINE = "I can't see photos sent in this chat yet. Send it with the food button on the phone and I'll estimate it, or tell me what it was.";
/** The real script with the plugin's state dir. Wired in by index.ts only. */
export declare const liveFoodRun: (stateDir?: string) => FoodRun;
/** The live offer in food-pending.json, or undefined. */
export declare function readFoodPending(stateDir: string, now: Date): FoodPendingView | undefined;
/** Per chat: when a non-food turn last happened, and the last food entry logged here (for "undo"). */
export declare class FoodMemory {
    private others;
    private logs;
    otherTurn(key: string, nowMs: number): void;
    logged(key: string, id: string, nowMs: number): void;
    lastLogged(key: string): {
        id: string;
        at: number;
    } | undefined;
    forgetLog(key: string): void;
    /** The offer is still what this chat is answering: nothing else was said since, and any label is the offer's own line. */
    bound(key: string, pending: FoodPendingView, label?: string): boolean;
}
export type FoodDeps = {
    run: FoodRun;
    stateDir: string;
    now: Date;
};
/** Carries out one food turn. Never throws; a failure is one honest sentence. */
export declare function runFoodTurn(turn: FoodTurn, deps: FoodDeps): Promise<FoodOutcome>;
