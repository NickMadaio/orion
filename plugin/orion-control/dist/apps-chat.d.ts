import type { AppsTurn } from "./apps-read.js";
export type AppsRun = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type AppsOutcome = {
    text: string;
    calls: string[];
    outputs: string[];
};
/** The real script. Wired in by index.ts only. */
export declare const liveAppsRun: () => AppsRun;
/** The commands one turn runs, in order. An "unused" turn that named examples closes those first. */
export declare function argsFor(turn: AppsTurn): string[][];
/** Carries out one apps turn. Never throws; a failure is one honest sentence. */
export declare function runAppsTurn(turn: AppsTurn, deps: {
    run: AppsRun;
}): Promise<AppsOutcome>;
