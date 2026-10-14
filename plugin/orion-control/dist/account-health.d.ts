export type AccountProblemKind = "credit" | "usage_limit" | "auth";
export type AccountProblem = {
    provider: string;
    kind: AccountProblemKind;
    detail: string;
    regainOn?: string;
};
type Handler = (event: Record<string, unknown>, ctx: Record<string, unknown>) => unknown;
type HookApi = {
    on: (name: string, fn: Handler) => unknown;
    logger?: {
        warn?: (m: string) => void;
    };
};
export type AccountHealthOptions = {
    statePath: string;
    outboxPath: string;
    /** Answer real turns with the problem instead of running them while it is fresh. Default off. */
    failFast?: boolean;
    /** How long a failure stays "fresh" for fail-fast before one real turn re-tests. Default 10 min. */
    recheckMs?: number;
    /** Provider of the configured primary model. Fail-fast needs it, and only acts when the problem is on it. */
    primaryProvider?: string;
    now?: () => number;
};
export declare function classifyAccountError(value: unknown, provider?: string): AccountProblem | undefined;
export declare function alertText(problem: AccountProblem): string;
export declare function registerAccountHealth(api: HookApi, options: AccountHealthOptions): void;
export {};
