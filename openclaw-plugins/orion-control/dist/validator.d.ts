import { type CapabilityTier } from "./catalog.js";
import type { TaskGraph, TaskStep, ValidationResult } from "./types.js";
export declare function hash(value: unknown): string;
export declare function canonicalActionHash(step: TaskStep, workingContext?: string): string;
export interface ValidationOptions {
    enabledTiers?: ReadonlySet<CapabilityTier>;
}
/** Hard structural caps so a malformed graph fails validation, not the runtime. */
export declare const MAX_STEPS = 32;
export declare const MAX_INPUTS = 64;
/**
 * Does the user's own sentence name this target?
 *
 * The old check was `content.includes(relativePath)`, which required the user
 * to have typed the joined path verbatim. Nobody says "awesome/orion.txt" out
 * loud; they say "a folder called awesome, and in it a file called orion.txt".
 * That rejected a perfectly explicit instruction.
 *
 * Every path segment must still appear in the user's words. So "awesome" plus
 * "orion.txt" authorizes `awesome/orion.txt`, while an instruction naming only
 * "awesome" cannot authorize `awesome/secrets.txt` — the basename is absent.
 * The guarantee is unchanged: the user must have named the thing.
 */
export declare function instructionNamesTarget(content: string, relativePath: string): boolean;
export declare function instructionNamesOperation(content: string, operation: string): boolean;
export declare function validateTaskGraph(graph: TaskGraph, options?: ValidationOptions): ValidationResult;
