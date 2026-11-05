import type { FlowResult } from "./schedule-flow.js";
import type { BedChange } from "./bedtime-read.js";
export type BedRun = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type Readback = {
    evening: string;
    sleepBy: string;
    nudgeAt: string;
    wake: string;
    wakeDate: string;
    alarmAsked: boolean;
    hours: number;
    lockdownBelowHours: number;
    tonightOnly: boolean;
    standing: string;
    fixed?: boolean;
};
export type BedResult = {
    ok: true;
    readback: Readback;
    was?: string;
    stdout: string;
} | {
    ok: false;
    error: string;
    stdout: string;
};
export declare const bedArgs: (c: BedChange) => string[];
/** Runs the one writer and parses its read-back; any failure is an error with the script's own reason. */
export declare function applyBedChange(c: BedChange, run: BedRun): Promise<BedResult & {
    args: string[];
}>;
/** What moved with the bedtime, in his words, from the read-back alone. */
export declare function bedtimeSentence(b: Readback, reset?: boolean): string;
export declare function runBedChange(c: BedChange, run: BedRun): Promise<{
    flow: FlowResult;
    tools: Array<{
        canonical: string;
        stdout: string;
        exit: number;
    }>;
}>;
