import type { FlowResult } from "./schedule-flow.js";
import type { Day } from "./schedule-flow.js";
import type { SessionExec } from "./session-flow.js";
import type { DeadlineRead } from "./deadline-read.js";
export { isDoneMessage, isReadyMessage, readAppsReply, readEarlyAnswer, readSiteOverride } from "./focus-ready-parse.js";
type Run = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type ReadyPending = {
    kind: "apps" | "early" | "task";
    task?: string;
    next?: string; /** the Mac app asked the question (Finish early): the next task is looked up from the plan when he answers */
    askNext?: boolean;
    marked?: boolean;
    at: number;
};
export type ReadyDeps = {
    exec: SessionExec;
    profile: Run;
    sites: Run;
    tasks: Run;
    resolveApp: (name: string) => Promise<string | null>;
    now: Date;
    /** Typed, or spoken and addressed to ORION: only then may a casual "lets get started" start anything. */
    mayStart: boolean;
    readDay?: () => Promise<Day | undefined>;
    readDeadlines?: () => Promise<DeadlineRead | null | undefined>;
    pending: {
        get(): ReadyPending | undefined;
        set(p: ReadyPending | undefined): void;
    };
};
/** One turn about starting or ending work. A fallback means the message is not about this, and nothing was touched. */
export declare function runFocusReady(message: string, deps: ReadyDeps): Promise<FlowResult>;
export declare const liveFocusProfile: Run;
export declare const liveFocusSites: Run;
export declare const liveTasksRun: Run;
/** The one open question, kept in a file so the Mac app (the Done early button) and this plugin share it. */
export declare const livePending: ReadyDeps["pending"];
