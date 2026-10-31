/**
 * Deterministic recipes for the computer loop (2026-10-30): one handler per clause kind, each
 * observe -> act -> re-read the AX tree -> verify the expected change -> one alternative -> honest failure.
 *
 * Preference order, from Nick's "the thing Sentient OS got right": an AX action on a named element
 * (press, set value, menu item) first; the keyboard shortcut or a coordinate click only as the retry.
 * A press that could send or submit is never retried (a second click could send twice).
 *
 * The model is used in exactly one place, `resolve`: when two on-screen candidates match his words equally,
 * it may name one BY NUMBER. Anything else it says is ignored.
 */
import { type Observation } from "./computer-ax.js";
import { type ComputerBridge } from "./computer-bridge.js";
import type { AppRef, Clause } from "./computer-intent.js";
export type StepLog = {
    readonly n: number;
    readonly action: string;
    readonly target?: string;
    readonly value?: string;
    readonly via: "open" | "ax" | "menu" | "key" | "type" | "click" | "observe";
    readonly ok: boolean;
    readonly verified: boolean;
    readonly note?: string;
};
export type Outcome = {
    readonly status: "ok";
    readonly said: string;
} | {
    readonly status: "ask";
    readonly ask: string;
    readonly confirmKey?: string;
} | {
    readonly status: "fail";
    readonly why: string;
};
export type Ctx = {
    readonly bridge: ComputerBridge;
    /** His own turn, verbatim: the only text authorization reads. */
    readonly words: string;
    readonly app?: AppRef;
    readonly maxSteps: number;
    readonly sleep: (ms: number) => Promise<void>;
    readonly progress: (line: string) => void;
    readonly pick?: (want: string, lines: string[]) => Promise<number | null>;
    readonly confirmed: ReadonlySet<string>;
    /** Loop bookkeeping: the action count, the step log, and the field the last step focused or typed into. */
    readonly state: {
        used: number;
        log: StepLog[];
        field?: string;
    };
};
/** Thrown when the next action would pass the cap; carries what the current clause had done so far. */
export declare class StepCap extends Error {
    readonly partial?: string | undefined;
    constructor(partial?: string | undefined);
}
export declare function matchesApp(o: Observation, app: AppRef): boolean;
export declare function openApp(ctx: Ctx, app: AppRef): Promise<Outcome>;
/** The app the clause acts on: the one he named (opened if it is not in front), else whatever is in front. */
export declare function frontFor(ctx: Ctx): Promise<Observation | Outcome>;
export declare function newDoc(ctx: Ctx, clause: Extract<Clause, {
    kind: "new_doc";
}>, o0: Observation): Promise<Outcome>;
export declare function typeText(ctx: Ctx, clause: Extract<Clause, {
    kind: "type";
}>, o0: Observation): Promise<Outcome>;
export declare function press(ctx: Ctx, clause: Extract<Clause, {
    kind: "click";
}>, o0: Observation, index: number): Promise<Outcome>;
export declare function menu(ctx: Ctx, clause: Extract<Clause, {
    kind: "menu";
}>, o0: Observation, index: number): Promise<Outcome>;
export declare function closeTabs(ctx: Ctx, clause: Extract<Clause, {
    kind: "close_tabs";
}>, o0: Observation, index: number): Promise<Outcome>;
export declare function closeWindow(ctx: Ctx, clause: Extract<Clause, {
    kind: "close_window";
}>, o0: Observation, index: number): Promise<Outcome>;
export declare function focusWindow(ctx: Ctx, clause: Extract<Clause, {
    kind: "focus";
}>, o0: Observation): Promise<Outcome>;
export declare function scroll(ctx: Ctx, clause: Extract<Clause, {
    kind: "scroll";
}>, o0: Observation): Promise<Outcome>;
/** Reads back the field the last step typed into (or the first one with text). Not an action: no step is spent. */
export declare function readBack(ctx: Ctx, o: Observation): Outcome;
