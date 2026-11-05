import type { ReplayCase } from "./types.js";
export declare const REPO_CASES: URL;
export declare function readCases(file: string | URL): ReplayCase[];
/** Every *.cases.json under a directory (the private corpus lives outside the repo). */
export declare function readCaseDir(dir: string): ReplayCase[];
