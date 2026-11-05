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
        ids?: string[];
    };
};
export declare const PHOTO_LINE = "I can't see photos sent in this chat yet. Send it with the food button on the phone and I'll estimate it, or tell me what it was.";
/** The real script with the plugin's state dir. Wired in by index.ts only. */
export declare const liveFoodRun: (stateDir?: string) => FoodRun;
/** The newest live offer in food-pending.json ({ offers: [...] }, or the older single object), with how many wait and their names. */
export declare function readFoodPending(stateDir: string, now: Date): FoodPendingView | undefined;
/** Per chat: when a non-food turn last happened, and the last food entry logged here (for "undo"). */
export declare class FoodMemory {
    private others;
    private logs;
    otherTurn(key: string, nowMs: number): void;
    /** `ids`: every entry one turn logged ("both"), so "undo" takes them all off; `id` is the last. */
    logged(key: string, id: string, nowMs: number, ids?: readonly string[]): void;
    lastLogged(key: string): {
        id: string;
        ids: string[];
        at: number;
    } | undefined;
    forgetLog(key: string): void;
    private touched;
    /** Any food turn in this chat (wall clock): "remove the eggs" a little later is about the meal log, not the calendar or water. */
    touch(key: string): void;
    recentFood(key: string): boolean;
    private offers;
    /** An answer ORION just gave about a food ends in "Log it?": remembered here, because food-pending.json is never written during an evaluation. */
    offered(key: string, food: string, nowMs: number): void;
    forgetOffer(key: string): void;
    /** The food of the offer this chat is still answering (nothing else said since, under 30 minutes old), or undefined. */
    chatOffer(key: string, nowMs: number): {
        food: string;
    } | undefined;
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
