import type { Reminder } from "./ambient.js";
export type TimerDeps = {
    add: (seconds: number, label: string) => Promise<Reminder>;
    list: () => Promise<Array<{
        id: string;
        kind?: string;
        dueAt: number;
    }>>;
    now: Date;
};
export type TimerOutcome = {
    text: string;
    calls: string[];
    outputs: string[];
    ok: boolean;
    label: string;
};
export type TimerAsk = {
    seconds: number;
    label: string;
};
/** "set a 10 min timer for the pasta": 600 s, "pasta". Undefined when it is not a new timer. */
export declare function readTimer(message: string): TimerAsk | undefined;
export declare function runTimer(ask: TimerAsk, deps: TimerDeps): Promise<TimerOutcome>;
