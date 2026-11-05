import type { Day, DayBlock, Intent } from "./schedule-flow.js";
type Mention = {
    level: number;
    words: string[];
    n: number;
};
/** The phrases of his message: runs of words that are not filler, verbs or bare numbers (a clock time breaks a run). */
export declare function phrases(message: string): string[][];
/** The best phrase of his that names this block: the highest level, then the longest. */
export declare function mentionOf(grams: string[][], block: DayBlock): Mention | undefined;
export type Reconciled = {
    steps: Intent[];
} | {
    ask: string;
};
/** The steps with each block pick matched to his words, or the question to ask when they cannot be matched. */
export declare function reconcileNamed(message: string, steps: readonly Intent[], day: Day): Reconciled;
export {};
