/**
 * Which of Nick's turns are computer use, and what they ask for (2026-10-30).
 *
 * Code, not the 9B, reads the request: a small closed set of clauses (open an app, new document, type, click,
 * close tabs or a window, focus a window, a menu path, scroll, read the screen). The model is used later only to
 * pick among on-screen candidates. Only Nick's own words come in here, never screen text, so nothing read off
 * the screen can add a clause.
 *
 * Conservative on purpose: a turn about messages, files, the calendar, reminders or secrets is never claimed
 * (those have their own flows and gates), and a turn with no UI object ("type up my essay tonight") is not either.
 */
import type { RoleGroup } from "./computer-ax.js";
export type AppRef = {
    readonly name: string;
    readonly bundleId?: string;
};
export type TargetRef = {
    readonly words: string;
    readonly group: RoleGroup;
    readonly generic: boolean;
};
export type TabFilter = {
    readonly mode: "all";
} | {
    readonly mode: "keep" | "only";
    readonly words: string;
    readonly count?: number;
} | {
    readonly mode: "ambiguous";
    readonly words: string;
};
export type Clause = {
    readonly kind: "open";
    readonly app: AppRef;
} | {
    readonly kind: "new_doc";
    readonly title?: string;
    readonly body?: string;
} | {
    readonly kind: "type";
    readonly text: string;
    readonly into?: TargetRef;
} | {
    readonly kind: "click";
    readonly target: TargetRef;
} | {
    readonly kind: "close_tabs";
    readonly filter: TabFilter;
} | {
    readonly kind: "close_window";
    readonly discard: boolean;
} | {
    readonly kind: "focus";
    readonly title: string;
} | {
    readonly kind: "menu";
    readonly path: readonly string[];
} | {
    readonly kind: "scroll";
    readonly direction: "up" | "down";
} | {
    readonly kind: "read_back";
};
export type ComputerIntent = {
    readonly kind: "read";
    readonly question: string;
    readonly wantsSummary: boolean;
} | {
    readonly kind: "act";
    readonly app?: AppRef;
    readonly clauses: readonly Clause[];
    readonly text: string;
};
/** Apps he names, by the words he uses for them. Unknown names still open by name (`open -a`). */
export declare const APPS: Readonly<Record<string, AppRef>>;
export declare function detectComputerIntent(message: string): ComputerIntent | null;
