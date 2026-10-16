export type ToolResult = {
    canonical: string;
    stdout: string;
    exit?: number | null;
};
type Outcome = "success" | "partial" | "nothing" | "pending" | "failed" | "read";
type Claim = {
    kind: "done" | "denial" | "promise" | "read";
    strength: "strong" | "status";
    sentence: string;
};
/** What a tool result says happened. exit null means "no exit code", not failure. */
export declare function outcomeOf({ canonical, stdout, exit }: ToolResult): Outcome;
export declare function claimsIn(reply: string): Claim[];
export type ReplyVerdict = {
    falseClaim: boolean;
    omittedFailure: boolean;
    falseDenial: boolean;
    wrongDetail: boolean;
    unbackedPromise: boolean;
    ok: boolean;
};
/** turnResults: this turn's tool results; conversationResults: used when the turn ran no tool. */
export declare function checkReply({ reply, turnResults, conversationResults, stateChanged, stateTimes }: {
    reply: string;
    turnResults?: ToolResult[];
    conversationResults?: ToolResult[];
    stateChanged?: boolean | null;
    stateTimes?: number[];
}): ReplyVerdict;
export type Block = {
    title: string;
    start: number;
    end: number;
};
/** Calendar sanity after a change: overlaps still ahead, blocks lost without a removing command, duplicates. */
export declare function checkCalendar({ before, after, now, commands }: {
    before: Block[];
    after: Block[];
    now: number;
    commands: string[];
}): string[];
/** Everything the check can see after the worker's final answer → findings (empty = looks right). */
export declare function checkWork({ reply, turnResults, finished, calendar, changeRequest, dictated, provided }: {
    reply: string;
    turnResults: ToolResult[];
    finished: boolean;
    calendar?: {
        before: Block[];
        after: Block[];
        now: number;
    };
    /** He asked for a change (not a question): a reply that only asks back, with nothing changed, is a failure. */
    changeRequest?: boolean;
    /** The reply was dictated by a code-run flow, which did its own reads outside turnResults. */
    dictated?: boolean;
    /** Code put the data in the prompt (his day, brain snippets, the overwhelm note): a reply from it is no fabricated lookup. */
    provided?: boolean;
}): string[];
/** The retry instruction handed to the worker: what the check found and what to do about it. */
export declare function retryInstruction(findings: string[]): string;
export {};
