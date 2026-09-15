export interface DevRepository {
    /** Absolute path to the repository root. */
    readonly root: string;
    /** What this repo is, for a person reading an approval or a ledger line. */
    readonly describe: string;
    /**
     * The commands, as fixed argv. Absent means the operation does not exist for
     * this repository and is refused rather than guessed at.
     */
    readonly test?: readonly string[];
    readonly build?: readonly string[];
    readonly install?: readonly string[];
}
/**
 * Every repository Orion may operate on, keyed by the short name he uses.
 *
 * A closed table on purpose. The alternative -- a root plus a path argument --
 * is one traversal bug away from being every repository on the machine, and
 * this program has already paid for one of those.
 *
 * `orion-plugin` is a subdirectory of `orion` and is listed separately rather
 * than reached with a path, because its test and build commands differ and
 * because "run the plugin's tests" should not be spelled as "run the repo's
 * tests, but over there".
 */
export declare const DEV_REPOSITORIES: ReadonlyMap<string, DevRepository>;
export type DevOperation = "git_status" | "git_log" | "git_diff" | "git_pull" | "tests_run" | "build_run" | "package_install";
/** Half a test log. Enough to see a failure, small enough not to be a transcript. */
export declare const MAX_OUTPUT_BYTES = 20000;
interface OperationSpec {
    /** Fixed argv, or the repository field holding it. */
    readonly argv: readonly string[] | keyof Pick<DevRepository, "test" | "build" | "install">;
    readonly timeoutMs: number;
    /** Does this reach the network? Recorded so a ledger line can say so. */
    readonly network: boolean;
    /** Does it change the working tree or run repository code? */
    readonly writes: boolean;
    readonly describe: string;
}
export declare const DEV_OPERATIONS: Readonly<Record<DevOperation, OperationSpec>>;
/**
 * The environment, built up rather than filtered down.
 *
 * A denylist of secret-looking variable names is wrong in the direction that
 * matters: it is correct only until somebody exports a new one. This starts
 * from nothing and adds the five things a build genuinely needs, so a token
 * added to Nick's shell profile tomorrow is absent here today.
 *
 * `PATH` is pinned rather than inherited for the same reason: an inherited
 * PATH is a list of directories any of which might contain a `git` that is not
 * git.
 */
export declare function devEnvironment(): Record<string, string>;
/** Resolve one operation against one repository, or say why it cannot be. */
export declare function resolveDevCommand(repository: string, operation: DevOperation, options?: {
    limit?: number;
    staged?: boolean;
}): {
    argv: readonly string[];
    cwd: string;
    spec: OperationSpec;
} | {
    error: string;
};
/**
 * Truncate in the middle.
 *
 * A failing test suite prints its summary last and its noise first, so keeping
 * the head is keeping the wrong half. Both ends are kept and the cut is
 * labelled with how much went, because output that was silently shortened is
 * output nobody can reason about.
 */
export declare function boundOutput(text: string, limit?: number): string;
export {};
