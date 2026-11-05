import type { Decision } from "./front-desk.js";
/** Every slot present, else null. Empty strings and undefined are missing. */
export declare function allSlots<T extends Record<string, unknown>>(slots: T): {
    [K in keyof T]: NonNullable<T[K]>;
} | null;
/** Whether a value the front desk (or any reader) produced appears in his words: every word of it of 3+ letters, or every number. */
export declare function inHisWords(message: string, value: unknown): boolean;
/** A past-tense or "I did" signal: he is telling ORION what happened, not what to put on the calendar. */
export declare const PAST_TENSE: RegExp;
/**
 * A calendar ask: a placing verb and a clock time, range or length ("put gym at 10-11", "add marketing from 7-9:30pm", "schedule a run for an hour at 6").
 * The workout, food, apps, shutdown and mouse routes never take one, whatever nouns it contains.
 */
export declare function schedulingAsk(message: string): boolean;
/** A direct question: ends in "?" or opens like one. */
export declare const isDirectQuestion: (message: string) => boolean;
/**
 * The front desk's move, gated:
 *  - a side-effect tool move whose verb is not aimed at that thing in his words becomes an escalation (the worker reads his words, with tools);
 *  - "ignore" never silences a direct question, spoken or typed (typed and phone turns are never silenced anyway: local-routing answers them
 *    or has the worker ask what he needs; only spoken room talk with no question in it stays quiet).
 */
export declare function gateDecision(decision: Decision, message: string, spoken?: boolean): Decision;
