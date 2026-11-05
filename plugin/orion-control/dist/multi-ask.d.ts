/** The asks in a message, or null when it is not a plain multi-request (fewer than two, or any clause is scheduling). */
export declare function splitAsks(raw: string): string[] | null;
/** The instruction for the worker: do every ask with tools, then one natural reply that says what happened to each. */
export declare function multiAskPrompt(asks: string[], hints?: Array<string | undefined>): string;
