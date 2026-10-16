/** He is telling ORION a fact to keep (not a question, not a reminder at a time). */
export declare function tellsFact(message: string): boolean;
/** A question about something he told ORION or keeps in his notes. */
export declare function asksRecall(message: string): boolean;
export declare const FACT_NOTE: string;
export declare const RECALL_NOTE: string;
export declare const FACT_NOW = "[ORION: save it now with exec /Users/nickmadaio/Desktop/ORION/scripts/orion-brain learn \"Nick\" \"fact\" \"\u2026\" \u2014 do not reply before the result.]";
export declare const RECALL_NOW = "[ORION: run exec /Users/nickmadaio/Desktop/ORION/scripts/orion-brain search first \u2014 do not reply before the result.]";
/** The lines under "## Learned" in his Nick note: what he actually told ORION, newest last. */
export declare function learnedLines(note: string, max?: number): string[];
/** Does a saved fact share a word (or stem) with the question? */
export declare const factsAbout: (message: string, lines: string[]) => string[];
/** "You told me / mentioned / said ..." about something no saved fact backs is a document's words, not his. */
export declare function reframeDocumentRecall(reply: string, message: string, lines: string[]): string;
/** The host appends a raw "Exec failed: `cmd`" line to a reply when a command is refused: never spoken to Nick. */
export declare const EXEC_FAILED_LINE: RegExp;
export declare const stripExecFailed: (text: string) => string;
export declare const SEARCH_UNAVAILABLE = "I couldn't search your notes just now. Ask me again in a moment.";
export declare const searchRefused: (results: string[]) => boolean;
