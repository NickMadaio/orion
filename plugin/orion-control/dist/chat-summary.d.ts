import type { MadeItem } from "./made-ledger.js";
export declare const asksChatSummary: (message: string) => boolean;
/** One sentence or two from the ledger and the calendar-change count; never a claim the tools did not show. */
export declare function chatSummary(items: readonly MadeItem[], calendarChanges: number): string;
