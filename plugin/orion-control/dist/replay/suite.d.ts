import type { Outcome, ReplayCase, Verdict } from "./types.js";
export type Summary = {
    total: number;
    pass: number;
    fail: number;
    xfail: number;
    xpass: number;
    skip: number;
};
export declare function classify(c: ReplayCase, failures: string[], outcome?: Outcome): Verdict;
export declare function runDeterministic(cases: readonly ReplayCase[]): Promise<Verdict[]>;
export declare function summarize(verdicts: readonly Verdict[]): Summary;
export declare const summaryLine: (s: Summary) => string;
/** A short report: every unexpected result in full, expected failures by audit id. */
export declare function report(verdicts: readonly Verdict[]): string;
export declare const unreadable: (cases: unknown) => cases is ReplayCase[];
