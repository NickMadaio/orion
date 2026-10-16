import type { Decision } from "./front-desk.js";
import type { FlowResult } from "./schedule-flow.js";
export type WakeExec = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type WakeRequest = {
    kind: "set";
    time: string;
} | {
    kind: "clear";
} | {
    kind: "read";
} | {
    kind: "repeat";
} | {
    kind: "ask";
};
export declare const ORION_WAKE = "/Users/nickmadaio/Desktop/ORION/scripts/orion-wake";
/** What he asked of his wake alarm, or null when it is not about it. `now` is kept for the call site's symmetry. */
export declare function parseWake(message: string, decision: Decision | undefined, _now: Date): WakeRequest | null;
/** One wake request, end to end; the reply is built only from orion-wake's output. */
export declare function runWakeFlow({ message, decision, now, exec }: {
    message: string;
    decision?: Decision;
    now: Date;
    exec: WakeExec;
}): Promise<FlowResult>;
/** The real flow: scripts/orion-wake. Wired in by index.ts only. */
export declare const liveWakeFlow: (message: string, decision?: Decision) => Promise<FlowResult>;
