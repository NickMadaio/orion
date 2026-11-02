import { type RememberRun } from "./preference-remember.js";
export type Correction = {
    fact: string;
    kind: "naming" | "meaning" | "standing" | "restated";
};
/** A correction he means to last, or undefined. Pure. */
export declare function readCorrection(message: string): Correction | undefined;
/** Learned preferences and rules in USER.md (one-line dated bullets), newest first, deduplicated. Pure. */
export declare function learnedRules(userMd: string | null, max?: number): string[];
/** The state-card line for them ("" when there are none or USER.md is unreadable). Never throws. */
export declare function standingRulesLine(userMdPath: string | undefined, maxChars?: number): string;
/** True while an evaluation holds the eval-mode marker in this state dir (under two hours old, as scripts/lib/eval-mode.mjs). */
export declare function inEvaluation(stateDir: string | undefined, now?: number): boolean;
/** Reads the message and, if it is a lasting correction, keeps it. Never throws; reports what happened. */
export declare function learnCorrection(message: string, o: {
    run: RememberRun;
    stateDir?: string;
    sessionKey?: string;
}): Promise<"saved" | "already" | "skipped" | "failed">;
