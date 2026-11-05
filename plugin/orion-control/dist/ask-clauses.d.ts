export type Clause = {
    text: string;
    start: number;
    end: number;
    sep: string;
};
export declare const REMINDER_START: RegExp;
export declare function clausesOf(message: string): Clause[];
/** The message without clause `i` (and the separator that joined it); undefined when nothing else would be left. */
export declare function withoutClause(message: string, clauses: readonly Clause[], i: number): string | undefined;
/** The first clause that `is` picks, with the message left once it is taken out; undefined when there is none or it is the whole message. */
export declare function takeClause(message: string, is: (clause: string) => boolean): {
    clause: string;
    rest: string;
} | undefined;
