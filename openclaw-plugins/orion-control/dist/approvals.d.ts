export declare const TICKET_RE: RegExp;
/**
 * How a person may write the id back.
 *
 * Phase 49: "make every authorization check satisfiable by the name a person
 * would actually type". So `a-7f3k`, `A-7F3K` and a bare `7F3K` are the same
 * ticket, and nothing here invents a token nobody would write.
 */
export declare function normalizeTicketId(raw: string): string | null;
export interface ApprovalTicket {
    id: string;
    canonicalHash: string;
    /** A random value the grant must echo, so a grant cannot be pre-written. */
    nonce: string;
    action: string;
    /** What Nick is being asked to allow, in his language rather than JSON. */
    summary: string;
    context: string;
    mintedAt: string;
    expiresAt: string;
    /**
     * Which Mac this approval is for.
     *
     * Phase 49 lists target device alongside capability, arguments hash,
     * expiration and nonce, and it is not ceremony: the approval directory is
     * syncable, and an approval that followed a file to another machine would be
     * an approval for an action nobody there asked for.
     */
    deviceId: string;
}
export interface ApprovalGrant {
    id: string;
    canonicalHash: string;
    nonce: string;
    grantedAt: string;
    /** Which human channel carried the yes. Never "orion", never "local". */
    grantedBy: string;
}
/** Long enough to walk to a terminal, short enough that a stale yes is gone. */
export declare const TICKET_TTL_MS: number;
export interface ApprovalPaths {
    tickets: string;
    grants: string;
    used: string;
}
export declare function approvalPaths(root: string): ApprovalPaths;
/**
 * Live tickets, newest first. Synchronous so callers that must stay pure can
 * use it; the directory holds at most a handful of files by construction.
 */
export declare function readTickets(paths: ApprovalPaths, now?: Date): ApprovalTicket[];
/**
 * Which canonical hashes a person has actually approved.
 *
 * A grant counts only when its ticket still exists, has not expired, and
 * carries the same nonce. That is what makes a grant unforgeable without also
 * forging the plugin's own mint: writing a grant for a hash you can compute is
 * not enough, you need the nonce that only the ticket has.
 */
export declare function grantedHashes(paths: ApprovalPaths, now?: Date): Map<string, {
    grant: ApprovalGrant;
    ticket: ApprovalTicket;
}>;
/**
 * Mint a ticket, or return the one already waiting for this exact hash.
 *
 * Deduplication is a safety property rather than a nicety. Without it a model
 * that retries produces a new id per attempt, Nick's phone fills with codes
 * that all mean the same thing, and the one he eventually types is whichever
 * he happened to read -- which is how a person ends up approving something
 * they have stopped reading.
 */
export declare function mintTicket(paths: ApprovalPaths, request: {
    canonicalHash: string;
    action: string;
    summary: string;
    context: string;
}, now?: Date): Promise<ApprovalTicket>;
/**
 * Spend a grant. Called once the gate has been satisfied and BEFORE the action
 * runs, so a failed action costs the approval rather than leaving one lying
 * around that a later attempt could pick up.
 */
export declare function consumeGrant(paths: ApprovalPaths, canonicalHash: string, now?: Date): Promise<boolean>;
/**
 * Write the grant. The one function in this file that represents a person
 * having said yes, and it is exported only for `orion-approve` and the
 * non-local branch of `orion-remote` -- nothing in the plugin's tool surface
 * calls it.
 */
export declare function grant(paths: ApprovalPaths, ticketId: string, grantedBy: string, now?: Date): Promise<{
    ok: true;
    ticket: ApprovalTicket;
} | {
    ok: false;
    reason: string;
}>;
/** Withdraw a waiting request without approving it. */
export declare function deny(paths: ApprovalPaths, ticketId: string, now?: Date): Promise<boolean>;
