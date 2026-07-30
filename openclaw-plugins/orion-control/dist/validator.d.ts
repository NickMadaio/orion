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
export declare function validateTaskGraph(graph: TaskGraph, options?: ValidationOptions): ValidationResult;
