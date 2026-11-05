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
 * A timer order joined to another ask, in either order ("set a 10 min timer and move my gym to 6", "move my gym to 6 and set a 10 min timer"):
 * the timer clause and the rest. Undefined for a single ask, or when the other side is not a request ("... for mac and cheese").
 */
export declare function splitTimerAsk(message: string): {
    timer: string;
    rest: string;
} | undefined;
export declare function runTimer(ask: TimerAsk, deps: TimerDeps): Promise<TimerOutcome>;
