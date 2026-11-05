export declare const OVERFLOW: RegExp;
export declare const OVERFLOW_LINE = "That chat got too long for me to hold, so I've trimmed the oldest part. Say go and I'll retry it.";
export declare const estimateTokens: (messages: readonly unknown[]) => number;
/** History tokens allowed for a model whose context budget is `contextTokens`: a third of it, never more than 12k, never less than 2k. */
export declare const historyBudget: (contextTokens: number | undefined) => number;
/** Drops the oldest messages until the rest fit `budget` tokens. The last message always stays; the first one left is a user turn, so a
 *  tool result never loses its call. When the current turn (the last user message on) is itself over budget, its oldest tool results
 *  lose their content (never their place) until it fits. Returns how many messages went. */
export declare function trimHistory(messages: unknown[], budget: number): number;
