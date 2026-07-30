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
/**
 * Is this action inside the scope the user asked for?
 *
 * The strict rule — every path segment present in the user's words — made
 * Orion demand you recite filenames back to it:
 *
 *   "make a text file of some sort"
 *   → "I need you to explicitly name the file you want created."
 *
 * That is not a security boundary, it is a spelling test. The things actually
 * protecting you are elsewhere and are untouched: authorization still requires
 * a real user turn recovered from the host transcript, actions are confined to
 * approved roots, there is no delete/move/rename, and every action is
 * ledgered. Specificity was never what stopped an injected instruction — the
 * injected text is not in your turn at all, which is the boundary that matters.
 *
 * So: you may be vague. Orion may fill in a detail you left open, provided the
 * action lands somewhere you did point at.
 *
 * Authorized when EITHER:
 *   - you named it — every path segment appears in your words (strict path); or
 *   - you named the place — the parent folder appears in your words, so Orion
 *     choosing `notes.txt` inside the `cooler` folder you asked for is fine; or
 *   - you asked generically for a file or folder and the target sits directly
 *     in an approved root, so "make me a text file" can land on the Desktop.
 *
 * Still refused: a target whose parent you never mentioned and which is not a
 * top-level create — Orion cannot wander into `Desktop/private/keys.txt` off
 * the back of "make me a note".
 */
export declare function instructionAuthorizesTarget(content: string, relativePath: string): boolean;
export declare function instructionNamesOperation(content: string, operation: string): boolean;
export declare function validateTaskGraph(graph: TaskGraph, options?: ValidationOptions): ValidationResult;
