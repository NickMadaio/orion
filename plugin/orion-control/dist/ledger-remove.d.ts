import type { LedgerDeps, LedgerOutcome } from "./ledger-run.js";
/** A note ORION saved: found in the vault by its own words, archived (reversible), and the archive's answer is what is reported. */
export declare function removeNote(deps: LedgerDeps, label: string): Promise<LedgerOutcome>;
/** Cancels the reminders whose label names every word given; says which, then reads the store again to confirm they are gone. */
export declare function removeReminder(deps: LedgerDeps, labels: string[], words?: string[]): Promise<LedgerOutcome>;
/**
 * "remove the eggs": the food path is taken only when the named thing IS in today's food log, or is plainly a food and nothing on the calendar
 * matches. A name on both ("dinner") is asked about; anything else (a haircut, a nap, a call) is undefined, so the calendar / ledger flows have it.
 * The removal is journaled by orion-log, so "undo" puts the entry back.
 */
export declare function removeFoodByWords(deps: LedgerDeps, words: string[], said: string): Promise<LedgerOutcome | undefined>;
