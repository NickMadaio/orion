import type { FlowResult } from "./schedule-flow.js";
export type TodoExec = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export declare const ORION_TASKS = "/Users/nickmadaio/Desktop/ORION/scripts/orion-tasks";
/** The to-do words he named, or null when this is not an imperative "mark it done" message. */
export declare function parseTodoDone(message: string): {
    words: string;
    imperative: boolean;
} | null;
/** One "mark it done" request, end to end; the reply is built only from orion-tasks' output. */
export declare function runTodoDone({ message, exec }: {
    message: string;
    exec: TodoExec;
}): Promise<FlowResult>;
/** The real flow: scripts/orion-tasks done. Wired in by index.ts only. */
export declare const liveTodoDoneFlow: (message: string) => Promise<FlowResult>;
