/**
 * What is NOT worth an automatic episode: injected scaffolding, bare
 * acknowledgements, quick questions, and replies that only make sense against
 * ORION's last message. Pure functions, shared by the live writer (episodic.ts)
 * and the cleanup CLI (scripts/orion-memory-clean.mjs).
 */
/** Nick's own words with every injected context block and label removed. */
export declare function stripInjectedContext(text: string): string;
/** The outreach sentence ORION sent first, if the turn carries one. */
export declare function outreachOf(text: string): string | undefined;
export declare function isFiller(candidate: string): boolean;
/** A quick question (even without its "?") is a lookup, not a memory. */
export declare function isQuickQuestion(candidate: string): boolean;
/** A reply that only means something next to what ORION just said. */
export declare function isDependentReply(candidate: string): boolean;
/** True when a candidate can never be an episode, whatever signal words it carries. */
export declare function isJunkCandidate(candidate: string): boolean;
/** Wrap a short dependent reply in the message it answers, so the line stands alone. */
export declare function combineWithOutreach(reply: string, outreach: string): string;
/** Same thing said twice: containment either way, or heavy word overlap. */
export declare function nearDuplicate(a: string, b: string): boolean;
export declare function episodeBody(line: string): string | undefined;
/**
 * Lines of one daily file that the live rule would not have written, with the
 * reason. Order matters: a later near-duplicate of an earlier kept line goes.
 */
export declare function junkEpisodeLines(content: string): Array<{
    index: number;
    line: string;
    reason: string;
}>;
