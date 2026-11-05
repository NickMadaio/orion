import type { Day } from "./schedule-flow.js";
import type { LedgerAsk } from "./ledger-ask.js";
import { type MadeItem } from "./made-ledger.js";
import type { StoredReminder } from "./reminder-flow.js";
export type JournalStep = {
    op?: string;
    title?: string;
    start?: string;
    end?: string;
};
export type JournalEntry = {
    at?: string;
    steps?: JournalStep[];
};
export type LedgerRun = (script: string, args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type LedgerDeps = {
    run: LedgerRun;
    readDay: (dateArgs: string[]) => Promise<Day | undefined>;
    items: MadeItem[];
    /** This chat's calendar changes: when the first and the latest happened (ms). Unset: none. */
    calendar?: {
        since: number;
        last: number;
    };
    journal: () => JournalEntry[];
    now: number;
    /** Whether this chat wrote the journal entry with that stamp (not another writer). Unset: any entry counts. */
    owned?: (at: string) => boolean;
    nothingText: string;
    reminders?: {
        list: () => Promise<StoredReminder[]>;
        remove: (ids: string[]) => Promise<void>;
    };
};
export type LedgerOutcome = {
    text: string;
    calls: string[];
    outputs: string[];
    removed: MadeItem[];
    wroteCalendar: boolean; /** A candidate asked about: his "yes" carries it out. */
    held?: {
        kind: MadeItem["kind"];
        label: string;
    };
};
/** How far back this chat's calendar change can still be what a bare "undo" takes back. */
export declare const CALENDAR_UNDO_WINDOW_MS: number;
/** The reply and effects for one ledger ask; undefined when a weak ask found nothing it owns (the turn goes on to the ordinary flows). */
export declare function runLedgerAsk(ask: LedgerAsk, deps: LedgerDeps): Promise<LedgerOutcome | undefined>;
