import { type ActionDefinition } from "./catalog.js";
export declare const STRICTNESS_MODES: readonly ["contained", "guarded", "open", "sovereign"];
export type StrictnessMode = (typeof STRICTNESS_MODES)[number];
/** The default, and the one mode whose behaviour is defined as "what shipped". */
export declare const DEFAULT_MODE: StrictnessMode;
export declare const MODE_SUMMARY: Record<StrictnessMode, string>;
declare const LADDER: readonly ["AUTO", "NOTIFY", "APPROVAL"];
export type GateLevel = (typeof LADDER)[number] | "NEVER";
export declare const FLOOR_REASONS: readonly ["authority_change", "third_party_reach", "irreversible"];
export type FloorReason = (typeof FLOOR_REASONS)[number];
export interface Floor {
    level: GateLevel;
    reason: FloorReason | null;
    because: string;
}
/**
 * An action's floor, read off the action.
 *
 * `authority_change` is matched on the NAME rather than on the tier, and that
 * is deliberate. `self_config` carries both halves: most of it is a timeout,
 * and one route of it decides what Orion may do. The catalog already splits
 * them by action name (`self_config_set` vs `self_config_authority_set`) and
 * that split is the one that matters here, so it is the one this reads.
 *
 * Everything is derived. Add an action to the catalog with
 * `reversible: false` and it floors at NOTIFY without anybody editing this
 * file -- which is the property that stops this from becoming the kind of
 * capability prose that was true when it was written.
 */
export declare function floorForAction(name: string, definition: ActionDefinition): Floor;
export declare function baseLevelFor(name: string, definition: ActionDefinition): GateLevel;
export declare function modeRequiresApproval(name: string, definition: ActionDefinition, mode: StrictnessMode, except?: Readonly<Record<string, GateLevel>>): boolean;
export interface LeveledCapability {
    /** What the catalog and the profile say, before any mode is applied. */
    base: GateLevel;
    /** What the mode would make it. */
    relaxed: GateLevel;
    /** What it actually is: the mode's answer, never below the floor. */
    level: GateLevel;
    floor: Floor;
    /** Set when the floor, not the mode, decided the outcome. */
    heldByFloor: boolean;
}
export declare function applyMode(base: GateLevel, floor: Floor, mode: StrictnessMode, options?: {
    reads?: boolean;
    exception?: GateLevel;
}): LeveledCapability;
/**
 * The exception that applies to one action, if any.
 *
 * Keyed by action name OR by capability tier, because both are things a person
 * says: "never let him delete a calendar event" and "nothing that touches the
 * calendar" are different sentences and both should work. The stricter of the
 * two wins when both are present.
 */
export declare function exceptionFor(name: string, definition: ActionDefinition, except: Readonly<Record<string, GateLevel>>): GateLevel | undefined;
export declare function levelForAction(name: string, definition: ActionDefinition, base: GateLevel, mode: StrictnessMode, except?: Readonly<Record<string, GateLevel>>): LeveledCapability;
/**
 * What is on disk. A mode plus the four things Phase 50 requires of any
 * delegation: when it expires, what it does not cover, which device it is for,
 * and who granted it.
 */
export interface StrictnessState {
    mode: StrictnessMode;
    version: number;
    setAt: string;
    setBy: string;
    reason: string;
    /** ISO instant, or null for "until changed". */
    expiresAt: string | null;
    /**
     * Per-tier exceptions. RAISING ONLY -- an exception may add friction to one
     * tier and may never remove it. "Allow calendar writes but never a delete"
     * is expressible; "sovereign, and also let this one thing through the floor"
     * is not, because that is just a floor with extra steps.
     */
    except: Readonly<Record<string, GateLevel>>;
    /** Which Mac this delegation is for. */
    deviceId: string | null;
    /**
     * Phase 50's RESOURCES: the folders this delegation covers, as absolute
     * prefixes. Empty means everywhere the mode reaches. Raise-only like
     * `except`: a file action whose target lies outside every prefix needs
     * approval, so "sovereign, but only under ~/Projects" is expressible and
     * cannot be widened by it.
     */
    resources?: readonly string[];
}
export declare const GUARDED_STATE: StrictnessState;
/**
 * The longest a delegation may run before it has to be renewed.
 *
 * Bounded rather than open-ended for a reason worth naming: expiry is
 * evaluated against the system clock at read time, so a clock that jumps
 * backwards extends whatever is in force. A cap means the blast radius of that
 * is a day, not forever. It is also the honest read of "I am going out" --
 * that is a delegation with an end, and one nobody has to remember to revoke.
 */
export declare const MAX_DELEGATION_MS: number;
export interface ResolvedStrictness {
    state: StrictnessState;
    /** The mode actually in force, after expiry. */
    mode: StrictnessMode;
    /** Set when a delegation was on file but has run out. */
    expired: boolean;
    /** Set when the file could not be trusted; the reason is for the operator. */
    degraded?: string;
}
/**
 * Read the delegation, and fall back to `guarded` for every possible reason.
 *
 * Every failure path here lands on `guarded`, never on anything softer. A
 * missing file, a corrupt file, a file naming a mode that does not exist, a
 * symlink where a file should be -- all of them mean "we do not know what was
 * delegated", and the only safe reading of that is the default.
 *
 * Synchronous on purpose: the validator is pure and synchronous, and every
 * test in this codebase depends on it staying that way.
 */
export declare function resolveStrictness(statePath: string, now?: Date): ResolvedStrictness;
/** Is `to` less friction than `from`? That is the direction that needs a human. */
export declare function isRelaxation(from: StrictnessMode, to: StrictnessMode): boolean;
export declare function writeStrictness(statePath: string, state: StrictnessState): Promise<void>;
/** Every action's level under one mode. Used by the status tool and the docs. */
export declare function levelMap(bases: ReadonlyMap<string, GateLevel>, mode: StrictnessMode, except?: Readonly<Record<string, GateLevel>>): Map<string, LeveledCapability>;
/** Kept out of the module's happy path so a caller must ask for it explicitly. */
export declare function seedIfAbsent(statePath: string): Promise<void>;
/**
 * The first file target of a step that lies outside the delegation's
 * resources, or null. Targets are an absolute `path`, or a named root plus
 * `relativePath` / `destinationPath`. No resources, or no file target, is null:
 * the scope limits where files may be touched, not what else may happen.
 */
export declare function targetOutsideResources(arguments_: Record<string, unknown>, resources: readonly string[], roots: Readonly<Partial<Record<string, string>>>): string | null;
export {};
