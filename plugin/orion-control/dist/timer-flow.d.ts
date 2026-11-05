import type { Reminder } from "./ambient.js";
export type TimerDeps = {
    add: (seconds: number, label: string) => Promise<Reminder>;
    list: () => Promise<Array<{
        id: string;
        kind?: string;
        dueAt: number;
    }>>;
    now: Date;
    /** "make it 10 min instead": the timer this one replaces, taken out first. */
    replace?: {
        id: string;
        remove: (id: string) => Promise<void>;
    };
};
export type TimerOutcome = {
    id?: string;
    text: string;
    calls: string[];
    outputs: string[];
    ok: boolean;
    label: string;
};
export type TimerAsk = {
    seconds: number;
    label: string;
    replace?: boolean;
};
/** "set a 10 min timer for the pasta": 600 s, "pasta". Undefined when it is not an order for a new timer. "instead" swaps the one just set (hasLast), else is nothing. */
export declare function readTimer(message: string, { hasLast }?: {
    hasLast?: boolean;
}): TimerAsk | undefined;
/**
 * An ask joined to another ask, in either order: the clause `isHit` picks (`hit`) and the rest, when the other side passes `isRest` (a request of its own,
 * so "... for mac and cheese" is never split). Undefined for a single ask.
 */
export declare function splitAsk(text: string, isHit: (part: string) => boolean, isRest: (part: string) => boolean): {
    hit: string;
    rest: string;
} | undefined;
/**
 * A timer order joined to other asks, in any position: the timer's own clause and the message left (ask-clauses.ts). Undefined for a single ask.
 * "set a 10 min timer for mac and cheese" is one clause; a reminder's words ("remind me at 5 to eat") are never taken for a timer.
 */
export declare function splitTimerAsk(message: string): {
    timer: string;
    rest: string;
} | undefined;
export declare function runTimer(ask: TimerAsk, deps: TimerDeps): Promise<TimerOutcome>;
