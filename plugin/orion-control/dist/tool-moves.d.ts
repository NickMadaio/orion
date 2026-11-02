import type { Decision } from "./front-desk.js";
export type ToolDirective = 
/** One orion_task_run call the worker must make; `note` is extra guidance for the reply. */
{
    kind: "call";
    action: string;
    args: string;
    note: string;
    failLine: string;
}
/** Nothing can do it: this text is the whole reply. */
 | {
    kind: "say";
    text: string;
};
/** He asked why ORION sent a weather notice: the forecast is looked up, then the reason is worded from it (never from memory). */
export declare function weatherDirective(sent: string): Extract<ToolDirective, {
    kind: "call";
}>;
export declare const isTimerRequest: (message: string) => boolean;
/** The exact job for a front-desk tool move, when code can know it; null leaves the turn to the worker. */
export declare function toolDirective(decision: Decision | undefined, message: string): ToolDirective | null;
