export type ScriptOut = {
    stdout: string;
    code: number;
};
export declare const refused: (o: ScriptOut) => boolean;
export declare const wrote: (o: ScriptOut) => boolean;
export declare const notBooked: (stdout: string, title: string) => boolean;
/** Undo entries an orion-tasks run made: one per day orion-reschedule wrote. */
export declare const writesIn: (stdout: string) => number;
/** One printed line as a plain clause with the block title it is about, or null when the line is not a collateral change. */
export declare function noteOf(l: string): [string, string] | null;
/** What else the scheduler moved, shortened or took off that the reply does not already name. Every one: no cap, so "Done" never
 *  hides a change to his calendar. */
export declare function sideNotes(reply: string, outputs: string[]): string[];
