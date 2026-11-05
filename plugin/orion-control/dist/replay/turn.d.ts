import { type Day } from "../schedule-flow.js";
import type { Decision } from "../front-desk.js";
import type { Intent } from "../schedule-flow.js";
import type { Outcome, Recorded, ReplayCase, ScriptCall } from "./types.js";
type RunResult = {
    stdout: string;
    code: number;
};
/** What the scheduler prints for a change that fits, built from the arguments (a refusal is only ever RECORDED, never invented). */
export declare function planned(args: string[]): string | undefined;
/** The live layer's way in: real local models and the real scheduler (in the sandbox), in place of recorded outputs. */
export type LiveHooks = {
    desk: (input: {
        message: string;
        clock: string;
        history?: Array<{
            role: "user" | "assistant";
            content: string;
        }>;
        context?: string;
    }) => Promise<Decision>;
    ask: (system: string, user: string, schema: object, budgetMs?: number) => Promise<{
        steps?: Intent[];
    } | null>;
    reschedule: (args: string[]) => Promise<RunResult>;
    /** One worker model pass; it may call tools through runTool (which runs the plugin's own guards) and answers with its reply. */
    worker: (a: {
        prompt: string;
        say: string;
        retry?: string;
        runTool: (toolName: string, params: Record<string, unknown>) => Promise<string>;
    }) => Promise<string>;
    /** What a tool the worker called answers (a read-only scheduler call runs for real in the sandbox; anything else is a canned "ok"). */
    tool: (toolName: string, params: Record<string, unknown>) => Promise<string>;
    /** The day the sandbox calendar starts with. */
    day?: Day;
};
/** A session of turns in one chat: per-chat memory (repeats, pending questions, undo) lives as long as the Session. */
export declare class Session {
    readonly surface: "mac" | "phone";
    private readonly spoken;
    private readonly live?;
    readonly dir: string;
    readonly scripts: ScriptCall[];
    private readonly handlers;
    private recorded;
    private clock;
    private n;
    private readonly previousDir;
    private closed;
    constructor(nowIso?: string, surface?: "mac" | "phone", spoken?: boolean, seed?: Record<string, unknown>, live?: LiveHooks | undefined);
    close(): void;
    private fire;
    private recorder;
    private day;
    private options;
    /** One message through every hook, then the worker's recorded reply through the finalize check (and its retries). */
    turn(say: string, recorded?: Recorded, advanceMs?: number, outreach?: string): Promise<Outcome>;
}
/** Runs one case's earlier turns, then the case itself, in one fresh session. */
export declare function playCase(c: ReplayCase): Promise<Outcome>;
export {};
