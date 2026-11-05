import { type LiveModels } from "./live-backend.js";
export type SuiteRow = {
    id: string;
    ok: boolean;
    failures: string[];
    ms: number;
    reply: string;
};
type Scenario = {
    id: string;
    now?: string;
    day?: Array<{
        title: string;
        start: string;
        end: string;
        kind?: string;
        fixed?: boolean;
    }>;
    say: string | string[];
    expect?: Record<string, unknown>;
    reminders?: Array<{
        title: string;
    }>;
};
export declare function loadScenarios(): Scenario[];
export declare function runScheduleSuites(models: LiveModels, only?: string[]): Promise<SuiteRow[]>;
export {};
