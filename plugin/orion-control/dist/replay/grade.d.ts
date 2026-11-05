import type { Expect, Outcome, ScriptCall } from "./types.js";
/** A script call that changes something (a read like show/status/--dry-run is not one). */
export declare const writes: (calls: readonly ScriptCall[]) => boolean;
export declare function gradeOutcome(expect: Expect, o: Outcome): string[];
