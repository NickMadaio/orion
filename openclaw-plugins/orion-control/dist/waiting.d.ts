export declare const WAITING_STORE: string;
export type WaitingStatus = "open" | "resolved" | "dismissed";
export interface WaitingItem {
    id: string;
    /** What Nick is waiting for, in his words. */
    what: string;
    /** Who owes it. A person, a company, or "nobody" for a process. */
    who: string;
    /**
     * The observable event that ends this. See the header: a note cannot be
     * resolved, an event can.
     */
    expect: string;
    /** ISO date. When Nick asked. */
    since: string;
    /** ISO date. After this it is overdue. Required — see the header. */
    dueBy: string;
    status: WaitingStatus;
    /** ISO instant. While in the future, the item stays quiet. */
    snoozedUntil?: string;
    /** Set when it resolves, so "how long did that take" is answerable. */
    resolvedAt?: string;
    /** The most recent follow-up draft, never sent. */
    draft?: {
        text: string;
        writtenAt: string;
    };
    /** How many times it has been surfaced. Caps the nagging. */
    surfaced: number;
}
export interface WaitingStore {
    version: 1;
    items: WaitingItem[];
}
export declare const EMPTY_STORE: WaitingStore;
/**
 * How many times one item may be raised before it stops raising itself.
 *
 * A waiting item that is never resolved and never dismissed becomes a daily
 * reminder forever, and a daily reminder forever is one people learn to
 * ignore -- along with the ones that matter. After this it stays in the list
 * and stops speaking, which is a different thing from being deleted.
 */
export declare const MAX_SURFACES = 5;
export declare function validateItem(value: unknown): string[];
/** Local civil date. `toISOString` is UTC and rolls over mid-evening in New York. */
export declare const civilToday: (now?: Date) => string;
/**
 * What is overdue, quiet, and worth saying out loud right now.
 *
 * Three separate conditions, and they are separate on purpose:
 *
 *   · past its due date          — the item's own promise, not a global age
 *   · not snoozed past now       — "remind me later" has to mean later
 *   · under the surfacing cap    — see MAX_SURFACES
 */
export declare function overdue(store: WaitingStore, now?: Date): WaitingItem[];
/** Open items that are not yet overdue — the honest "what's outstanding" answer. */
export declare function pending(store: WaitingStore, now?: Date): WaitingItem[];
/** Days late, for a sentence a person can act on. */
export declare const daysLate: (item: WaitingItem, now?: Date) => number;
/**
 * A follow-up, written and NOT sent.
 *
 * The gate decision this phase needed, made explicitly: drafting is one step
 * from sending, and `messages_send` sits at the APPROVAL floor because a sent
 * message is on somebody else's device in a second with no unsend. So a draft
 * is text stored on the item. Nothing here can deliver it, and turning a draft
 * into a message goes through the ordinary outbound gate with an approval
 * ticket, exactly as if Orion had composed it fresh.
 *
 * Deliberately plain. A follow-up that sounds like it was generated is worse
 * than no follow-up, and the person receiving it is not the one being helped.
 */
export declare function draftFollowUp(item: WaitingItem, now?: Date): string;
