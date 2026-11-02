import { type MailAlert } from "./mail-alerts.js";
export type MailRule = {
    action: "mute" | "boost";
    kind: "sender" | "domain" | "topic";
    value: string;
    label: string;
};
export type MailAsk = {
    kind: "ask";
    text: string;
};
export type MailMove = {
    kind: "rules";
    action: "mute" | "boost";
    rules: MailRule[];
} | MailAsk;
export type MailPrefsRun = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type MailOut = {
    text: string;
    calls: string[];
    outputs: string[];
};
export type MailCtx = {
    stateDir: string;
    now: Date;
    label?: string;
    lastPush?: {
        text: string;
        at: string;
    } | null;
    alerts?: MailAlert[];
};
/** A copy of scripts/lib/mail/domains.mjs PROTECTED_DOMAINS (his school + freemail). Change both together. */
export declare const PROTECTED_DOMAINS: readonly string[];
/** What this message teaches about his mail, if anything. Reads only. */
export declare function readMailMove(message: string, ctx: MailCtx): MailMove | undefined;
/** Saves the rules through orion-mail-prefs and says what was saved, from its answers. */
export declare function runMailMove(move: MailMove, run: MailPrefsRun): Promise<MailOut>;
/** The real script (no shell, fixed argument lists), with ORION's state dir. Wired in by local-routing.ts. */
export declare const liveMailPrefsRun: (stateDir?: string) => MailPrefsRun;
