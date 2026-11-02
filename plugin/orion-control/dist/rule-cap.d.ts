export declare const MAX_RULES = 30;
type Removed = {
    line: string;
    action: "drop-duplicate" | "drop-over-cap";
};
/** Rules merged and capped, with what went and why. Pure. */
export declare function capRulesDetailed(text: string, max?: number): {
    text: string;
    removed: Removed[];
};
/** Rules merged and capped; `dropped` lists the removed lines. Pure. */
export declare function capRules(text: string, max?: number): {
    text: string;
    dropped: string[];
};
/** True when USER.md already holds a rule or preference with the same words as `fact` ("Rule: …" / "Preference: …"). */
export declare function hasRule(userMd: string | null, fact: string): boolean;
/** Applies the cap to the file on disk and logs each removal (full text) to `<stateDir>/learned-rules.jsonl`. Never throws. */
export declare function enforceRuleCap(userMdPath: string, stateDir?: string, now?: Date): number;
export {};
