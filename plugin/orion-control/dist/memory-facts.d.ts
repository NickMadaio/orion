/** He is telling ORION a fact to keep (not a question, not a reminder at a time). */
export declare function tellsFact(message: string): boolean;
/** A question about something he told ORION or keeps in his notes. */
export declare function asksRecall(message: string): boolean;
export declare const FACT_NOTE: string;
export declare const RECALL_NOTE: string;
export declare const FACT_NOW = "[ORION: save it now with exec orion-brain learn \"Nick\" \"fact\" \"\u2026\" \u2014 do not reply before the result.]";
export declare const RECALL_NOW = "[ORION: run exec orion-brain search first \u2014 do not reply before the result.]";
