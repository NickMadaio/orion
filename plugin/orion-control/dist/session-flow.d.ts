import type { FlowResult } from "./schedule-flow.js";
export type SessionExec = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type SessionRequest = {
    task: string;
    minutes?: number;
    until?: string;
    apps: string[];
};
/** What the front desk read from his words: its session start, task and length (fills only what his words leave out). */
export type SessionHint = {
    start?: boolean;
    task?: string;
    minutes?: number;
};
export declare const ORION_SESSION = "/Users/nickmadaio/Desktop/ORION/scripts/orion-session";
export declare const isSessionStart: (message: string) => boolean;
/** His words start a session, or the front desk read a start and nothing in his words rules one out. */
export declare const startsSession: (message: string, hint?: SessionHint) => boolean;
/** His request, or null. A front-desk start (hint.start) counts only when nothing in his words rules a start out. */
export declare function parseSessionRequest(message: string, hint?: SessionHint): SessionRequest | null;
/** One start request, end to end. Returns a FlowResult whose reply is built only from script output. */
export declare function runSessionFlow({ message, hint, exec, resolveApp }: {
    message: string;
    hint?: SessionHint;
    exec: SessionExec;
    resolveApp: (name: string) => Promise<string | null>;
}): Promise<FlowResult>;
/** "how much focus time is left", read by code (sweep 2026-10-15, q049/q053: the worker called nothing
 *  and said "still active with 15 minutes remaining"). A read only: nothing is started or changed. */
export declare function runSessionStatus({ exec }: {
    exec: SessionExec;
}): Promise<FlowResult>;
/** The real flow: Orion.app's session socket through orion-session. Wired in by index.ts only. */
export declare const liveSessionFlow: (message: string, hint?: SessionHint) => Promise<FlowResult>;
/** The real status read (orion-session status --json). Wired in by index.ts only. */
export declare const liveSessionStatus: () => Promise<FlowResult>;
