/** The words that name it: "cs group" -> ["cs"]. A name made only of generic words falls back to all its words. */
export declare function nameWords(name: string): string[];
declare const hostOf: (url: string) => string;
/** Candidate addresses for a name, best first, one per host: addresses written near the name in his notes, then domains he has been on that carry its words. */
export declare function pageCandidates(name: string, found: {
    snippets?: string;
    domains?: string[];
}): string[];
/** What is said for each outcome (the page is opened by the caller when there is exactly one). */
export declare const askWhich: (name: string, urls: string[]) => string;
export declare const askLink: (name: string) => string;
export { hostOf };
