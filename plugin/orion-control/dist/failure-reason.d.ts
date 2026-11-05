export type ReasonKind = "bedtime" | "started" | "over" | "no_block" | "no_room" | "fixed_event" | "other_day" | "exists" | "needs_time" | "unknown";
export type Reason = {
    kind: ReasonKind;
    what?: string;
    at?: string;
    now?: string;
    bedtime?: string;
    raw?: string;
};
/** A structured reason: {reason: "bedtime"} or {reason: {code, what, at, now, bedtime}} (also `kind`/`code` at the top level). */
export declare function fromStructured(input: unknown): Reason | undefined;
/** One scheduler failure line (as it reads today) or a structured reason → a Reason. */
export declare function parseReason(input: string | Record<string, unknown>): Reason;
declare const ucfirst: (s: string) => string;
/** What happened, as a clause that reads after "I couldn't do that because" or alone ("gym at 10:00 PM is after your bedtime"). */
export declare function reasonClause(r: Reason): string;
/** The concrete next step for this reason, as a question or an offer Nick can answer in a word. */
export declare function reasonOffer(r: Reason): string;
/** A different, more useful line for the same failure asked again: the reason plus what to do next, never the first line again. */
export declare function repeatOffer(r: Reason): string;
/** A failure line already spoken ("I couldn't do that: gym at 10 PM is after your bedtime...") read back into a reason, by its words. */
export declare function reasonFromSpoken(text: string): Reason;
export { ucfirst };
