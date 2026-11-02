import { type QuestionRow } from "./questions-store.js";
export type QuestionsRun = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type QuestionsMove = {
    kind: "list";
    open: QuestionRow[];
} | {
    kind: "drop";
    id?: string;
    q?: string;
} | {
    kind: "answer";
    id: string;
    q: string;
    text: string;
} | {
    kind: "skip";
    id: string;
    q: string;
};
export type QuestionsOut = {
    text: string;
    calls: string[];
    outputs: string[];
};
export declare const asksForQuestions: (message: string) => boolean;
export declare const dropsQuestion: (message: string) => {
    about?: string;
} | undefined;
export type QuestionsCtx = {
    stateDir: string;
    now: Date;
    label?: string;
    lastPush?: {
        text: string;
        at: string;
    } | null;
    rows?: QuestionRow[];
};
/** What this message does to ORION's questions, if anything. Reads only. */
export declare function readQuestionsMove(message: string, ctx: QuestionsCtx): QuestionsMove | undefined;
/** Carries the move out through orion-questions and says what happened, from its answer. */
export declare function runQuestionsMove(move: QuestionsMove, run: QuestionsRun): Promise<QuestionsOut>;
/** The real script (no shell, fixed argument lists), with ORION's state dir. Wired in by local-routing.ts. */
export declare const liveQuestionsRun: (stateDir?: string) => QuestionsRun;
