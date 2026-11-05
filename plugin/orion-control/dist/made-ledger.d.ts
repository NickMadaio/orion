export type MadeKind = "block" | "note" | "reminder" | "food" | "water";
export type MadeItem = {
    kind: MadeKind;
    /** What it is called: the block's title, the note's words, the reminder's label, the food's name. */
    label: string;
    at: number;
    /** Block: the `--date` words it was booked for (empty = today). */
    dateArgs?: string[];
    /** Food: the health-log ids one turn logged. Water: bottles added. */
    ids?: string[];
    count?: number;
};
export type MadeTool = {
    canonical: string;
    stdout: string;
};
/** How long a made thing can still be "that" or "the one i just made". */
export declare const LEDGER_WINDOW_MS: number;
/** The words that name a thing: lowercase, no filler, no tense ("stretch", "careers", "mum"). */
export declare function contentWords(text: string): string[];
/** Every word he used names something in the label (a word is a prefix of one of the label's words, or the other way round). */
export declare function namesLabel(words: readonly string[], label: string): boolean;
/** What one tool result made, if it made something. Reads only the command and what it printed. */
export declare function madeBy(tool: MadeTool, now: number): MadeItem[];
export declare class MadeLedger {
    private chats;
    /** Reads what a finished turn made out of its tool results. */
    ingest(key: string | undefined, tools: readonly MadeTool[], now: number): void;
    record(key: string | undefined, item: MadeItem): void;
    /** This chat's live entries, oldest first. */
    recent(key: string | undefined, now: number): MadeItem[];
    /** The same list without one entry (the thing was taken off). */
    forget(key: string | undefined, item: MadeItem): void;
}
