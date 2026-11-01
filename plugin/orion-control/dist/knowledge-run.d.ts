import type { KnowledgeHeld, KnowledgeMove } from "./knowledge-moves.js";
export type KnowledgeRun = (script: "orion-brain" | "orion-trash", args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type KnowledgeOut = {
    text: string;
    held?: KnowledgeHeld;
    calls: string[];
    outputs: string[];
};
/** Runs one move; `held` is what the reply now waits on (one turn). */
export declare function runKnowledgeMove(move: KnowledgeMove, run: KnowledgeRun): Promise<KnowledgeOut>;
/** The real scripts (no shell, fixed argument lists), found by the plugin's scripts-dir resolver. Wired in by index.ts only. */
export declare const liveKnowledgeRun: KnowledgeRun;
