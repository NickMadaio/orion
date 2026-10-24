export declare const STAGE_LABELS: {
    readonly understanding: "working out what you need";
    readonly "reading-calendar": "checking your calendar";
    readonly "reading-tomorrow": "looking at tomorrow";
    readonly "checking-todos": "checking your to-dos";
    readonly "checking-deadlines": "checking what's due";
    readonly "checking-notes": "looking through my notes";
    readonly "checking-messages": "reading your messages";
    readonly "changing-calendar": "making the change on your calendar";
    readonly thinking: "putting the answer together";
    readonly "double-checking": "double-checking the answer";
    readonly "using-tool": "running a tool";
};
export type StageId = keyof typeof STAGE_LABELS;
export type ProgressEntry = {
    readonly stage: StageId;
    readonly label: string;
    readonly at: string;
    readonly detail?: string;
};
export type ProgressDoc = {
    readonly v: 1;
    readonly sessionKey: string;
    readonly runId: string | null;
    readonly startedAt: string;
    readonly updatedAt: string;
    readonly stages: readonly ProgressEntry[];
    readonly done: boolean;
};
/** Most stages a single turn keeps; a tool loop cannot grow the file without bound. */
export declare const MAX_STAGES = 24;
/** The file name for a session key: anything but letters, digits, dot, dash and underscore becomes "_". */
export declare function progressFileName(sessionKey: string): string;
export declare function beginDoc(sessionKey: string, runId: string | null, now: Date): ProgressDoc;
/** A new stage, unless it repeats the last one (same stage and detail): a tool loop of reads is one "checking your calendar". */
export declare function addStage(doc: ProgressDoc, stage: StageId, now: Date, detail?: string): ProgressDoc;
export declare function finishDoc(doc: ProgressDoc, now: Date): ProgressDoc;
/** What code read for the turn (`Run.reads`) as stages, in order, without repeats. */
export declare function stagesForReads(reads: readonly string[] | undefined): StageId[];
/** The title a calendar write names (`--title "Gym"`, `--plan "Gym, 90, 17:50"`, `move "Gym"`), for "moving Gym". */
export declare function writeTarget(command: string): string | undefined;
/** The stage a host tool call stands for. `exec` is read through its command line. */
export declare function stageForTool(toolName: string, command?: string): {
    stage: StageId;
    detail?: string;
};
/** Holds one doc per session and writes it on every change. Never throws. */
export declare class TurnProgress {
    private readonly dir;
    private readonly now;
    private readonly docs;
    constructor(dir: string, now?: () => Date);
    fileFor(sessionKey: string): string;
    current(sessionKey: string): ProgressDoc | undefined;
    begin(sessionKey: string, runId: string | null): void;
    stage(sessionKey: string | undefined, stage: StageId, detail?: string): void;
    finish(sessionKey: string | undefined): void;
    private put;
}
