import { type Resident } from "./live-backend.js";
import type { ReplayCase } from "./types.js";
export type LiveOptions = {
    dir: string;
    only?: string[];
    desk?: string;
    worker?: string;
    label?: string;
    compare?: string;
    repoCases: ReplayCase[];
    schedule?: string;
    limitGood?: number;
};
export type LiveRow = {
    id: string;
    kind: "replay" | "schedule";
    ok: boolean;
    failures: string[];
    ms: number;
    route?: string;
    reply?: string;
    model?: string;
};
export type LiveSummary = {
    label: string;
    desk: string;
    worker: string;
    at: string;
    rows: LiveRow[];
    passRate: number;
    medianMs: number;
    p90Ms: number;
    resident: Resident[];
};
export declare const percentile: (xs: readonly number[], p: number) => number;
/** Every audit turn, and an even spread of the good ones (the chat turns that worked) so a run stays an hour or two, not a day. */
export declare function sample(cases: readonly ReplayCase[], limitGood: number): ReplayCase[];
export declare function runLive(opts: LiveOptions): Promise<number>;
