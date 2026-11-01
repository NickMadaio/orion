type Tool = {
    canonical: string;
    stdout: string;
};
/** The reply for a task run held for approval this turn (the draft and a question), or undefined. */
export declare function approvalAsk(tools: readonly Tool[]): string | undefined;
export {};
