import { type RememberRun } from "./preference-remember.js";
export { MAX_RULES, capRules } from "./rule-cap.js";
export type Correction = {
    fact: string;
    kind: "naming" | "meaning" | "standing" | "restated";
};
/** A correction he means to last, or undefined. `offered` is what ORION just proposed (its last push or offer), if any. Pure. */
export declare function readCorrection(message: string, o?: {
    offered?: string;
}): Correction | undefined;
/** Learned preferences and rules in USER.md (one-line dated bullets), newest first, deduplicated. Pure. */
export declare function learnedRules(userMd: string | null, max?: number): string[];
/** The state-card line for them ("" when there are none or USER.md is unreadable). Never throws. */
export declare function standingRulesLine(userMdPath: string | undefined, maxChars?: number): string;
/** True while an evaluation holds the eval-mode marker in this state dir (under two hours old, as scripts/lib/eval-mode.mjs). */
export declare function inEvaluation(stateDir: string | undefined, now?: number): boolean;
/** True when a session key is Nick's own chat (or unknown): never a job, check, mission, sweep or evaluation. */
export declare const isNickSession: (sessionKey: string | undefined) => boolean;
/** What ORION has just proposed, as words to compare a "dont …" against: the app's label, the last push (2 h), a held own offer, a memo. */
export declare function pendingOffer(o: {
    label?: string | undefined;
    stateDir?: string | undefined;
    now: Date;
    held?: boolean;
    memo?: {
        kind: string;
        title?: string;
    } | undefined;
}): string | undefined;
/** Reads the message and, if it is a lasting correction, keeps it (capped, never twice). Never throws; reports what happened. */
export declare function learnCorrection(message: string, o: {
    run: RememberRun;
    stateDir?: string;
    sessionKey?: string;
    offered?: string;
    userMdPath?: string;
}): Promise<"saved" | "already" | "skipped" | "failed">;
