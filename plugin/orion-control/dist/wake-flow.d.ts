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
} | {
    kind: "bedtime";
};
export declare const ORION_WAKE = "/Users/nickmadaio/Desktop/ORION/scripts/orion-wake";
/** What he asked of his wake alarm, or null when it is not about it. A time comes only from his words (or his direct
 *  answer to ORION's question, `answering`), never from the front desk's args. `now` is kept for the call site's symmetry. */
export declare function parseWake(message: string, decision: Decision | undefined, _now: Date, answering?: boolean): WakeRequest | null;
/** One wake request, end to end; the reply is built only from orion-wake's output. */
export declare function runWakeFlow({ message, decision, now, exec, answering }: {
    message: string;
    decision?: Decision;
    now: Date;
    exec: WakeExec;
    answering?: boolean;
}): Promise<FlowResult>;
export declare const liveWakeFlow: (message: string, decision?: Decision) => Promise<FlowResult>;
