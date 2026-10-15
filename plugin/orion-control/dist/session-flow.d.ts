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
export declare const ORION_SESSION = "/Users/nickmadaio/Desktop/ORION/scripts/orion-session";
export declare const isSessionStart: (message: string) => boolean;
export declare function parseSessionRequest(message: string): SessionRequest | null;
/** One start request, end to end. Returns a FlowResult whose reply is built only from script output. */
export declare function runSessionFlow({ message, exec, resolveApp }: {
    message: string;
    exec: SessionExec;
    resolveApp: (name: string) => Promise<string | null>;
}): Promise<FlowResult>;
/** The real flow: Orion.app's session socket through orion-session. Wired in by index.ts only. */
export declare const liveSessionFlow: (message: string) => Promise<FlowResult>;
