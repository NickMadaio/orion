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

/** What pressing a button with this label does to the world, judged from its words alone. */
const OUTWARD = /\b(send|post|publish|share|reply|tweet|invite|pay|buy|purchase|order|checkout|check out|transfer|donate|subscribe|book|place order|confirm (?:purchase|payment|order))\b/i;
const DESTRUCTIVE = /\b(delete|remove|erase|trash|discard|clear all|empty|don'?t save|do not save|reset|uninstall|sign out|log out|revert|overwrite|replace)\b/i;
const SUBMIT = /^(submit|ok|okay|go|continue|next|search|done|apply|save|confirm|yes|allow|accept|sign in|log in|enter)$/i;

/** macOS writes "Don’t Save" with a curly apostrophe; so does a phone keyboard. */
const straight = (text: string) => text.replace(/[’‘]/g, "'");

export function classifyLabel(label: string): LabelClass {
  const text = straight(label).replace(/[…."]/g, "").trim();
  if (OUTWARD.test(text)) return "outward";
  if (DESTRUCTIVE.test(text)) return "destructive";
  if (SUBMIT.test(text)) return "submit";
  return "neutral";
}

/** Effect families: a label's family must appear in his words for an irreversible press to count as named. */
const FAMILIES: ReadonlyArray<{ readonly label: RegExp; readonly said: RegExp }> = [
  { label: /\b(send|reply|invite|share)\b/i, said: /\b(send|reply|invite|share)\b/i },
  { label: /\b(post|publish|tweet)\b/i, said: /\b(post|publish|tweet)\b/i },
  { label: /\b(pay|buy|purchase|order|checkout|check out|transfer|donate|subscribe|book)\b/i, said: /\b(pay|buy|purchase|order|check ?out|transfer|donate|subscribe|book)\b/i },
  { label: /\b(don'?t save|do not save|discard|revert|delete)\b/i, said: /\b(without saving|don'?t save|dont save|do not save|discard|throw (?:it )?away|delete)\b/i },
  { label: /\b(remove|erase|trash|empty|clear all)\b/i, said: /\b(remove|erase|trash|empty|clear|delete)\b/i },
  { label: /\b(reset|uninstall|overwrite|replace)\b/i, said: /\b(reset|uninstall|overwrite|replace)\b/i },
  { label: /\b(sign out|log out)\b/i, said: /\b(sign out|log out|logout)\b/i },
];

export function effectNamed(label: string, words: string): boolean {
  return FAMILIES.some((family) => family.label.test(straight(label)) && family.said.test(straight(words)));
}

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

export type AuthDecision =
  | { readonly ok: true; readonly basis: string }
  | { readonly ok: false; readonly basis: string; readonly ask: string };

/**
 * Whether pressing an element with `label` may happen now. `words` is his own turn, verbatim, and nothing else:
 * passing screen text here would let the screen authorise itself.
 */
export function authorizePress(label: string, words: string, origin: StepOrigin): AuthDecision {
  if (origin.confirmed) return { ok: true, basis: "confirmed" };
  const kind = classifyLabel(label);
  const shown = JSON.stringify(label.trim().slice(0, 40));
  if (kind === "neutral") {
    return origin.requested || !origin.generic ? { ok: true, basis: "reversible" } : { ok: false, basis: "unrequested", ask: `Should I press ${shown}?` };
  }
  if (kind === "submit") {
    if (origin.requested && (!origin.generic || origin.unique)) return { ok: true, basis: origin.generic ? "asked-unique" : "named" };
    return { ok: false, basis: "submit-unclear", ask: `The button says ${shown}. Press it?` };
  }
  if (origin.requested && effectNamed(label, words)) return { ok: true, basis: "named-irreversible" };
  const effect = kind === "outward" ? "sends or commits something" : "can't be undone";
  return { ok: false, basis: `unnamed-${kind}`, ask: `The next step is pressing ${shown}, which ${effect}. Go ahead?` };
}

/** "yes", "do it", "go ahead"; and "no", "stop", "leave it". */
export const isYes = (text: string): boolean => /^\s*(?:y(?:es|eah|ep|up)?|sure|ok(?:ay)?|do it|go(?: ahead)?|confirm(?:ed)?|press it|yes please)\b[\s.!]*$/i.test(text);
export const isNo = (text: string): boolean => /^\s*(?:no|nope|nah|stop|cancel|don'?t|leave it|never ?mind)\b/i.test(text);
