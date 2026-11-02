import type { FlowResult } from "./schedule-flow.js";
import type { KnowledgeRun } from "./knowledge-run.js";
export type PersonLearned = {
    flow: FlowResult;
    call?: {
        canonical: string;
        stdout: string;
        exit: number;
    };
};
/** Keeps the person he named, if any, and adds one line to the reply saying so. */
export declare function learnPersonAfter(flow: FlowResult, message: string, run: KnowledgeRun): Promise<PersonLearned>;
