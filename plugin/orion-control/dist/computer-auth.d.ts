/**
 * Who said the computer loop may take a step (2026-10-30).
 *
 * Nick's rule, verbatim: "If I specifically say to — 'download this', 'do this' — that is permission.
 * Otherwise, confirm irreversible only."
 *
 * The old `directUserAuthorizationRequired` wording-match was deleted on 2026-08-04 (docs/GAME_PLAN.md §1.2–1.3)
 * because matching phrasing was theatre; what replaced it is "block what cannot be undone, log everything else"
 * plus a DATA taint rule: a target that came from untrusted content and not from Nick is refused. This file
 * keeps both halves, mapped onto the screen:
 *
 *  1. AUTHORITY COMES ONLY FROM HIS TURN. Every step the loop takes descends from a clause parsed out of his own
 *     words (computer-intent.ts). Screen text never creates a step; it is only matched against what he named.
 *  2. REVERSIBLE STEPS HE ASKED FOR RUN with no per-click approval: opening, focusing, typing, menus, new
 *     documents, scrolling, pressing neutral buttons, closing the tabs or windows he named.
 *  3. IRREVERSIBLE STEPS (a button that sends, posts, pays, buys, deletes or discards) run only when his words
 *     name that effect ("send it", "delete", "without saving"). A generic "hit the button" that lands on one of
 *     those stops and asks. A plain submit-class button ("Submit", "OK", "Search") runs when he asked for that
 *     click and it is the only candidate; with several, it asks which.
 *  4. STEPS HE DID NOT ASK FOR (a save sheet or confirmation that appears mid-task) that are irreversible always
 *     stop and ask. His "yes" to that exact question is then the authority for that one step.
 *
 * Nothing here fabricates a `trusted_user` input or an approval hash: the catalog's R5 actions
 * (screen_click/type/key, approvalRequired, never demoted) are untouched. This loop is a separate, code-built
 * flow that only runs from his live turn, the same standing the other local-route flows have.
 */
export type LabelClass = "outward" | "destructive" | "submit" | "neutral";
export declare function classifyLabel(label: string): LabelClass;
export declare function effectNamed(label: string, words: string): boolean;
export type StepOrigin = {
    /** The step comes straight from one of his clauses (not a dialog that appeared, not a recipe extra). */
    readonly requested: boolean;
    /** His clause referred to the target only generically ("the button"). */
    readonly generic: boolean;
    /** The target was the only candidate of its kind on screen. */
    readonly unique: boolean;
    /** He answered "yes" to this exact question already. */
    readonly confirmed: boolean;
};
export type AuthDecision = {
    readonly ok: true;
    readonly basis: string;
} | {
    readonly ok: false;
    readonly basis: string;
    readonly ask: string;
};
/**
 * Whether pressing an element with `label` may happen now. `words` is his own turn, verbatim, and nothing else:
 * passing screen text here would let the screen authorise itself.
 */
export declare function authorizePress(label: string, words: string, origin: StepOrigin): AuthDecision;
/** "yes", "do it", "go ahead"; and "no", "stop", "leave it". */
export declare const isYes: (text: string) => boolean;
export declare const isNo: (text: string) => boolean;
