export declare const ORION_MESSAGES = "/Users/nickmadaio/Desktop/ORION/scripts/orion-messages";
export declare const ORION_GMAIL_SEARCH = "/Users/nickmadaio/Desktop/ORION/scripts/orion-gmail-search";
export type MessagesRead = {
    kind: "recent";
    limit: number;
} | {
    kind: "from";
    person: string;
    limit: number;
} | {
    kind: "search";
    text: string;
    limit: number;
} | {
    kind: "gmail";
    query: string;
};
export type ReadExec = (file: string, args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type ReadOutcome = {
    calls: string[];
    outputs: string[];
    say?: string;
    data?: string;
    note?: string;
};
/** What a plain read of his texts or Gmail asks for, or null (a send, or not a read). */
export declare function parseMessagesRead(message: string): MessagesRead | null;
export declare function failureLine(req: MessagesRead, out: string): string;
/** The command for a read: file + argv only (no shell). */
export declare function readCommand(r: MessagesRead): {
    file: string;
    args: string[];
    canonical: string;
};
/** Runs the read. say = code's exact reply (failure or nothing found); data = what the worker summarizes. */
export declare function runMessagesRead(req: MessagesRead, exec: ReadExec): Promise<ReadOutcome>;
/** The worker's instruction for a read code already ran: summarize this and nothing else. */
export declare function readNote(req: MessagesRead, data: string): string;
/** The real read: read-only scripts. Wired in by index.ts only. */
export declare const liveMessagesRead: (req: MessagesRead) => Promise<ReadOutcome>;
