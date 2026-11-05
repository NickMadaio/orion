import type { LedgerDeps, LedgerOutcome } from "./ledger-run.js";
/** A note ORION saved: found in the vault by its own words, archived (reversible), and the archive's answer is what is reported. */
export declare function removeNote(deps: LedgerDeps, label: string): Promise<LedgerOutcome>;
/** Cancels the reminders whose label names every word given; says which, then reads the store again to confirm they are gone. */
export declare function removeReminder(deps: LedgerDeps, labels: string[], words?: string[]): Promise<LedgerOutcome>;
