/** Edit distance (insert, delete, substitute), for typo matching. */
export declare function lev(a: string, b: string): number;
/** Common typos in a request's key words, fixed by an alias list and a small edit distance against the words the parser reads. */
export declare function fixTypos(text: string): string;
export declare const NOT_A_REQUEST: RegExp;
export declare const COURTESY: RegExp;
export declare const TAKEN_BACK: RegExp;
export declare const DOUBT: RegExp;
/** The replan gate: the message starts with the request and does not take it back at the end. */
export declare const startsAsRequest: (text: string) => boolean;
export declare const SECOND_THOUGHTS: RegExp;
export declare const HEARSAY: RegExp;
export declare const POLITE: RegExp;
/** A report of what already happened ("we did resume then gym", "i went to the gym first"): never a follow-up order. */
export declare const PAST_REPORT: RegExp;
export type Refusal = "question" | "take-back" | "doubt" | "hearsay" | "second-thoughts" | "not-a-request";
/** A question is not an order, but "can you … ?" ending the message is a polite one. */
export declare const isQuestionText: (text: string) => boolean;
/**
 * Why this message is not an order, or undefined when nothing rules it out. Runs on the raw and the typo-fixed text.
 * `lenient`: second thoughts and the negation list are not checked (a follow-up "actually do resume before gym", or an add
 * after "I'm fine… I'm just annoyed"), but take-backs, doubt, hearsay and questions always are.
 */
export declare function refusalOf(raw: string, opts?: {
    lenient?: boolean;
    followUp?: boolean;
}): Refusal | undefined;
