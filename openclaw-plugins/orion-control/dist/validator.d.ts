import { type CapabilityTier } from "./catalog.js";
import type { TaskGraph, TaskStep, ValidationResult } from "./types.js";
export declare function hash(value: unknown): string;
export declare function canonicalActionHash(step: TaskStep, workingContext?: string): string;
export interface ValidationOptions {
    enabledTiers?: ReadonlySet<CapabilityTier>;
    /**
     * Harness-owned lookup for paths Orion already wrote under an authenticated
     * turn. Supplied by the plugin entry from `HarnessProvenance`; absent in
     * tests and in any caller that has no session, where it defaults to "no".
     */
    isSelfAuthored?: (candidate: string) => boolean;
}
/** Hard structural caps so a malformed graph fails validation, not the runtime. */
export declare const MAX_STEPS = 32;
export declare const MAX_INPUTS = 64;
export declare function urlCarriesUntrustedData(rawUrl: string, untrustedText: string): boolean;
export declare function argumentsCarryUntrustedData(arguments_: Record<string, unknown>, untrustedText: string, userText: string, isSelfAuthored?: (candidate: string) => boolean): string | undefined;
export declare function validateTaskGraph(graph: TaskGraph, options?: ValidationOptions): ValidationResult;
