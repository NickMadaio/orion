/**
 * Search terms from an event, mechanically.
 *
 * Longest words first, because a long word is a more specific search than a
 * short one, and bounded to three because a four-term search of somebody's
 * mail is a search that returns everything.
 */
export declare function termsFromEvent(title: string, attendees?: readonly string[]): string[];
export interface PrepSection {
    label: string;
    /** ok | empty | unavailable. An unavailable source is never shown as empty. */
    status: "ok" | "empty" | "unavailable";
    lines: string[];
    reason?: string;
}
/**
 * Render the card.
 *
 * A section that could not be read says so. That is the same rule
 * `orion-standing` is built around, and it exists because "no relevant email"
 * and "I could not search your email" look identical to a reader and mean
 * opposite things — one is reassuring and one means the card is incomplete.
 */
export declare function renderCard(event: {
    title: string;
    when: string;
    attendees: readonly string[];
}, sections: readonly PrepSection[]): string;
