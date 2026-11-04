import type { FlowResult } from "./schedule-flow.js";
import { type KnownName } from "./work-start.js";
export type SessionExec = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
/** orion-focus-profile / orion-focus-sites with fixed arguments. */
export type ProfileRun = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type SessionRequest = {
    task: string;
    minutes?: number;
    until?: string;
    apps: string[];
};
/** What the front desk read: its start counts; its task only when his words contain it; its length never. */
export type SessionHint = {
    start?: boolean;
    task?: string;
    minutes?: number;
};
export declare const ORION_SESSION = "/Users/nickmadaio/Desktop/ORION/scripts/orion-session";
/** casual: a casual "let's work on X" may count (REV5 MUST 4: only when typed, or said to ORION by name; the caller knows which).
 *  known: blocks on his day and deadlines, so a course name ("econ") can resolve; without them only a work noun counts. */
export type StartOpts = {
    casual?: boolean;
    known?: readonly KnownName[];
};
export declare const isSessionStart: (message: string, opts?: StartOpts) => boolean;
/** His words start a session, or the front desk read a start and nothing in his words rules one out (a calendar item does: review of efc37af).
 *  REV5: when a casual start is not allowed (spoken, not to ORION), a desk-read start needs a session word in his words. */
export declare const startsSession: (message: string, hint?: SessionHint, opts?: StartOpts) => boolean;
export declare function readApps(message: string): string[];
/** His request, or null. A front-desk start (hint.start) counts only when nothing in his words rules a start out. */
export declare function parseSessionRequest(message: string, hint?: SessionHint): SessionRequest | null;
export declare const STRICT_LINE = "Firm app blocking can't be switched on from chat, so it's the timer only; I'm not blocking anything.";
/** One start request, end to end. Returns a FlowResult whose reply is built only from script output. */
export declare function runSessionFlow({ message, hint, exec, resolveApp, profile, sites }: {
    message: string;
    hint?: SessionHint;
    exec: SessionExec;
    resolveApp: (name: string) => Promise<string | null>;
    /** w19: with both, a session just started also gets its task's profile and the site allow-list. */
    profile?: ProfileRun;
    sites?: ProfileRun;
}): Promise<FlowResult>;
/** "how much focus time is left", read by code (sweep 2026-10-15, q049/q053: the worker called nothing
 *  and said "still active with 15 minutes remaining"). A read only: nothing is started or changed. */
export declare function runSessionStatus({ exec }: {
    exec: SessionExec;
}): Promise<FlowResult>;
export declare const liveResolveApp: (name: string) => Promise<string | null>;
/** orion-session with fixed arguments (no shell), for the focus moves (focus-moves.ts). Wired in by index.ts only. */
export declare const liveSessionExec: SessionExec;
/** The real flow: Orion.app's session socket through orion-session. Wired in by index.ts only. */
export declare const liveSessionFlow: (message: string, hint?: SessionHint) => Promise<FlowResult>;
/** The real status read (orion-session status --json). Wired in by index.ts only. */
export declare const liveSessionStatus: () => Promise<FlowResult>;
