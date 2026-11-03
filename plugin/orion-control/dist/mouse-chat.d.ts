import type { MousePending, MouseTurn } from "./mouse-read.js";
export type MouseRun = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type MouseOutcome = {
    text: string;
    calls: string[];
    outputs: string[];
    pending?: MousePending;
    confirm?: boolean;
};
/** The real script with the plugin's state dir. Wired in by index.ts only. */
export declare const liveMouseRun: (stateDir?: string) => MouseRun;
/** Per chat: what ORION is waiting on, until anything else is said or ten minutes pass. */
export declare class MouseMemory {
    private waiting;
    wait(key: string, nowMs: number, w: {
        pending?: MousePending;
        confirm?: boolean;
    }): void;
    clear(key: string): void;
    get(key: string, nowMs: number): {
        pending?: MousePending;
        confirm?: boolean;
    } | undefined;
}
export type MouseDeps = {
    run: MouseRun;
};
/** Carries out one mouse turn. Never throws; a failure is one honest sentence. */
export declare function runMouseTurn(turn: MouseTurn, deps: MouseDeps): Promise<MouseOutcome>;
