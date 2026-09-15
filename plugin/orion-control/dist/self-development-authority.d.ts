/** Off tonight, and every night after this one until something turns it on
 * deliberately. Not read from an environment variable or a config file --
 * both are things a local model's own diff could eventually touch, and a
 * kill switch that the thing it switches off can move is not a kill switch. */
export declare const GOVERNED_SELF_DEVELOPMENT_ENABLED: false;
export declare class GovernedSelfDevelopmentDisabledError extends Error {
    constructor();
}
/** Call this at the single entry point that would ever hand a diff to a
 * local model for authorship. Throws unconditionally while the flag is off. */
export declare function assertGovernedSelfDevelopmentEnabled(): void;
export interface ForbiddenSurface {
    readonly pattern: RegExp;
    readonly reason: string;
}
/**
 * Checked in order; the first match wins. Patterns are anchored (`^...$` or
 * a directory prefix) against a POSIX-style, repo-root-relative path, never
 * against a bare filename -- so `notes/approvals.ts` does not collide with
 * the real `approvals.ts` and a same-named file elsewhere in the tree cannot
 * borrow its refusal or, worse, its absence of one.
 */
export declare const FORBIDDEN_SELF_CHANGE_SURFACES: readonly ForbiddenSurface[];
export declare class SelfChangeForbiddenError extends Error {
    readonly path: string;
    readonly surfaceReason: string;
    constructor(path: string, surfaceReason: string);
}
/** The matching entry, or `undefined` if the path is not on the deny-list. */
export declare function forbiddenSelfChangeSurface(relativePath: string): ForbiddenSurface | undefined;
/**
 * The one function anything proposing a diff must call before accepting it.
 * Throws `SelfChangeForbiddenError` naming the first forbidden path found;
 * returns nothing when every path is acceptable.
 */
export declare function assertDiffAllowed(paths: readonly string[]): void;
