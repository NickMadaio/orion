import type { Outcome, Recorded, ReplayCase, ScriptCall } from "./types.js";
/** What the scheduler prints for a change that fits, built from the arguments (a refusal is only ever RECORDED, never invented). */
export declare function planned(args: string[]): string | undefined;
/** A session of turns in one chat: per-chat memory (repeats, pending questions, undo) lives as long as the Session. */
export declare class Session {
    readonly surface: "mac" | "phone";
    private readonly spoken;
    readonly dir: string;
    readonly scripts: ScriptCall[];
    private readonly handlers;
    private recorded;
    private clock;
    private n;
    private readonly previousDir;
    private closed;
    constructor(nowIso?: string, surface?: "mac" | "phone", spoken?: boolean, seed?: Record<string, unknown>);
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
