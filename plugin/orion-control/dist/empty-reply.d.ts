export declare const EMPTY_MARK = "I came back with nothing";
/** The honest line. `reason` is one short clause (a failed tool, "the model didn't answer in time"). */
export declare function emptyReplyLine(reason?: string): string;
export declare const isBlank: (reply: string | undefined) => boolean;
export declare const isEmptyLine: (reply: string) => boolean;
/** A why-question about the reply that was blank: it is that reply he means. */
export declare function whyEmptyLine(reason?: string): string;
