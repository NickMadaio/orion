export interface TranscriptTurn {
    content: string;
    /** Milliseconds since epoch, from the entry's own timestamp when present. */
    at: number;
    sessionId: string;
}
export interface TranscriptOptions {
    /** Defaults to ~/.openclaw/agents. */
    agentsRoot?: string;
    /** Which agent's sessions to look in. Defaults to "main". */
    agent?: string;
    /** Session id from the host, when the hook supplied one. */
    sessionId?: string;
    now?: () => number;
}
/**
 * Pull the text out of one transcript line, but only if the host attributed it
 * to the user. Anything else — assistant, system, tool — is not evidence of an
 * instruction and is ignored.
 */
export declare function userTextFromLine(line: string): string | undefined;
/**
 * The most recent user-authored turns in the bound session, oldest first.
 *
 * Returns an empty array rather than throwing: a missing or unreadable
 * transcript must fail closed like every other absent provenance source, not
 * error out of a tool call.
 */
export declare function readRecentUserTurns(options?: TranscriptOptions & {
    limit?: number;
}): Promise<TranscriptTurn[]>;
/**
 * The single most recent user-authored turn. Retained because the trust
 * provenance health readout and its tests speak in terms of one turn.
 */
export declare function readLatestUserTurn(options?: TranscriptOptions): Promise<TranscriptTurn | undefined>;
