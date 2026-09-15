/**
 * Select durable, user-authored facts and decisions without asking a model.
 *
 * This is the fast episodic stream, not semantic memory. It intentionally
 * over-captures a few project decisions into the daily journal; the later
 * consolidation pass decides what deserves long-term promotion. Zero model
 * calls means capture cannot itself become a token leak.
 */
export declare function episodeFromUserText(input: string): string | undefined;
export declare function defaultEpisodicMemoryPath(configured?: string): string;
export declare function appendEpisode(memoryDirectory: string, episode: string, now?: Date): Promise<{
    written: boolean;
    path: string;
}>;
