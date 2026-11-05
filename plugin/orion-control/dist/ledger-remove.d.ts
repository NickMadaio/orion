import type { LedgerDeps, LedgerOutcome } from "./ledger-run.js";
/** A note ORION saved: found in the vault by its own words, archived (reversible), and the archive's answer is what is reported. */
export declare function removeNote(deps: LedgerDeps, label: string): Promise<LedgerOutcome>;
/** Cancels the reminders whose label names every word given; says which, then reads the store again to confirm they are gone. */
export declare function removeReminder(deps: LedgerDeps, labels: string[], words?: string[]): Promise<LedgerOutcome>;
/**
 * "remove the eggs" in a chat that has been about food: the entry is taken off today's food log by its words. The reply is the script's own
 * line, or says plainly that no such meal is logged: water is never the answer to a removal.
 */
export declare function removeFoodByWords(deps: LedgerDeps, words: string[], said: string): Promise<LedgerOutcome | undefined>;
