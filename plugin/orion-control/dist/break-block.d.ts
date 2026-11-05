import type { Day } from "./schedule-flow.js";
import type { BreakMove } from "./break-intent.js";
export type BreakCalendar = {
    line?: string;
    note?: string;
    calls: string[];
    outputs: string[];
    writes: number;
};
type Run = (script: "orion-reschedule", args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export declare function breakOnCalendar(move: BreakMove, deps: {
    run: Run;
    readDay: () => Promise<Day | undefined>;
    now: Date;
}): Promise<BreakCalendar>;
export {};
