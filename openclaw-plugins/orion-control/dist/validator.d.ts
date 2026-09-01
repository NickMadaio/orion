import { type ActionDefinition, type CapabilityTier } from "./catalog.js";
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
    /**
     * Reject arguments an action does not accept.
     *
     * Only applies to actions with no hand-written `validateArguments`, because
     * only there is the accepted set fully declared. Default off: turning it on
     * makes calls fail that succeed today, which is more correct and is still a
     * change to a working system.
     */
    strictArguments?: boolean;
}
/** Hard structural caps so a malformed graph fails validation, not the runtime. */
export declare const MAX_STEPS = 32;
export declare const MAX_INPUTS = 64;
export declare function urlCarriesUntrustedData(rawUrl: string, untrustedText: string): boolean;
export declare function argumentsCarryUntrustedData(arguments_: Record<string, unknown>, untrustedText: string, userText: string, isSelfAuthored?: (candidate: string) => boolean): string | undefined;
export declare function argumentNotFromUser(definition: ActionDefinition, arguments_: Record<string, unknown>, userText: string): {
    key: string;
    value: string;
} | undefined;
/**
 * Was this turn actually ABOUT permission?
 *
 * The last of the four checks that stand between Orion and a wider set of
 * powers, and the only one that is new. The other three already existed and are
 * reused rather than reimplemented:
 *
 *   1. `authorizeTaskGraph` mints `trusted_user` only from OpenClaw host
 *      provenance, so there is no byte the model controls that can forge the
 *      instruction this function reads.
 *   2. `argumentsCarryUntrustedData` refuses a target that appears in something
 *      Orion read and in nothing Nick said.
 *   3. `argumentNotFromUser` requires the target to appear in Nick's own words,
 *      so "yes, go ahead" widens nothing — the flag has to be named.
 *
 * What none of those can tell apart is "what does enableMessagesSendActions do?"
 * from "turn enableMessagesSendActions on". Both name the flag, in his own
 * voice, untainted. Only the second is a request for authority, and only the
 * second should move a switch — so the turn has to carry a word about
 * permission as well as the name of the thing.
 *
 * This is the same shape `changePermissionProfile` has demanded of a profile
 * change since it was written: name the profile AND say something about
 * permission. Applying it here closes the gap where the other route to the same
 * outcome — a config flag — asked for less than the profile route did.
 */
export declare function authorityInstructionMissing(definition: ActionDefinition, userText: string): boolean;
export declare function validateTaskGraph(graph: TaskGraph, options?: ValidationOptions): ValidationResult;
