/**
 * Select durable, user-authored facts and decisions without asking a model.
 *
 * This is the fast episodic stream, not semantic memory. It intentionally
 * over-captures a few project decisions into the daily journal; the later
 * consolidation pass decides what deserves long-term promotion. Zero model
 * calls means capture cannot itself become a token leak.
 */
/**
 * Only Nick's own words. Remote messages arrive as ONE user turn: the
 * transport's context (live facts, channel rules) and then "--- Nick's message
 * follows ---". Capturing the whole turn wrote those rules into his journal as
 * if he had said them (found 2026-09-29: "It is not a website: never open a…").
 */
export declare function nickWords(input: string): string;
export declare function episodeFromUserText(rawInput: string): string | undefined;
export declare function defaultEpisodicMemoryPath(configured?: string): string;
export declare function appendEpisode(memoryDirectory: string, episode: string, now?: Date): Promise<{
    written: boolean;
    path: string;
}>;
