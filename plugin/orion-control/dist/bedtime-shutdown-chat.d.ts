import type { ShutdownTurn } from "./bedtime-shutdown-read.js";
export type ShutdownRun = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type ShutdownOutcome = {
    text: string;
    calls: string[];
    outputs: string[];
};
export declare const liveShutdownRun: () => ShutdownRun;
export declare function argsFor(turn: ShutdownTurn): string[];
export declare function runShutdownTurn(turn: ShutdownTurn, deps: {
    run: ShutdownRun;
}): Promise<ShutdownOutcome>;
