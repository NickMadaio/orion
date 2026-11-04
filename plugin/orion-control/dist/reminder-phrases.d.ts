/** Only the words a reminder hinges on are repaired: a sentence that is not about reminders is left exactly as it was. */
export declare function fixTypos(message: string): string;
/** The days a repeating request names, `unsupported` for a repeat he cannot do, undefined when it is not a repeat at all. */
export declare function repeatOf(message: string): {
    days: number[];
} | {
    unsupported: string;
} | undefined;
/** A part of the day, as a default time, when he named no clock time. */
export declare function periodTime(message: string): string | undefined;
export declare const wantsHome: (message: string) => boolean;
export declare const isImportantAsk: (message: string) => boolean;
