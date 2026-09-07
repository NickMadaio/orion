import type { PermissionProfile } from "./permissions.js";
import type { StrictnessMode } from "./strictness.js";
export declare const PERSONALITY_IDS: readonly ["main", "vent", "coach", "research", "creative"];
export type PersonalityId = (typeof PERSONALITY_IDS)[number];
export type MemoryLean = "broad" | "focused" | "minimal";
export type PlanningStyle = "direct" | "exploratory" | "reflective" | "brainstorm";
/**
 * Which of the roles ALREADY declared in `model-roles.seed.json` a
 * personality leans toward. Not a model id, not a provider, not a
 * capability -- a name that must already exist in the role contract, so
 * leaning toward it can never introduce a model, a provider or a credential
 * that was not already configured for everyone.
 */
export type ModelRoleLean = "reasoning" | "local" | "fast" | "coder";
export type SourceBreadth = "narrow" | "normal" | "wide";
/**
 * What a personality may express. Read the file header before adding a field:
 * if it names a capability, a tier, a permission, a strictness level, an
 * allowlist entry or a filesystem root, it does not belong here -- it belongs
 * nowhere in this repo's personality system, because the whole point is that
 * there is nowhere for it to go.
 */
export interface PersonalityProfile {
    readonly id: PersonalityId;
    readonly label: string;
    /** One line, folded into the system prompt. How it sounds, not what it can do. */
    readonly tone: string;
    readonly memoryLean: MemoryLean;
    readonly planningStyle: PlanningStyle;
    readonly modelRoleLean: ModelRoleLean;
    readonly sourceBreadth: SourceBreadth;
}
export declare const PERSONALITIES: Readonly<Record<PersonalityId, PersonalityProfile>>;
/**
 * Raised only for a field this system will never define, on purpose. Its
 * message is the one guarantee callers get to depend on: unrestricted speech,
 * restricted capabilities.
 */
export declare class PersonalityAuthorityViolation extends Error {
    constructor(field: string);
}
/**
 * Validate an untyped candidate against the allowlist above, then against
 * each field's own vocabulary. Refuses ANY key this module has not already
 * named -- including a real one spelled differently, and including anything
 * that looks like authority. There is no fallback path that admits an
 * unrecognised key "for now".
 */
export declare function parsePersonalityProfile(candidate: unknown): PersonalityProfile;
/**
 * What a session actually may do, untouched by which personality is speaking.
 * Sourced from the real gate (`permissions.ts` / `strictness.ts`) elsewhere in
 * the plugin; this type only names the shape so a personality can be composed
 * alongside it without ever being able to write to it.
 */
export interface SessionAuthority {
    readonly permissionProfile: PermissionProfile;
    readonly strictnessMode: StrictnessMode;
}
export interface ConversationConfiguration {
    readonly personality: PersonalityProfile;
    readonly authority: SessionAuthority;
}
/**
 * Combine a personality with a session's authority. This is the whole
 * mechanism, and it is deliberately not a merge: `authority` passes through
 * BY REFERENCE. There is no line in this function that reads a
 * `PersonalityProfile` field and writes it into the authority half, because
 * `PersonalityProfile` has no field that could mean "widen this" in the first
 * place. personalities.test.ts asserts referential equality on the returned
 * `authority` for exactly this reason -- a future edit that started merging
 * fields in would break that assertion before it shipped.
 */
export declare function composeConversationConfiguration(personality: PersonalityProfile, authority: SessionAuthority): ConversationConfiguration;
