import type { FlowResult } from "./schedule-flow.js";
export type NoteExec = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export declare const ORION_BRAIN = "/Users/nickmadaio/Desktop/ORION/scripts/orion-brain";
/** His words with only the command removed, or null when there is no command or nothing after it. */
export declare function parseNote(message: string): {
    text: string;
} | null;
/** Sentences in his text: ". ! ?" runs and line breaks end one; a run-on with no punctuation is one. */
export declare function countSentences(text: string): number;
/** "4 sentences", or the word count for one long run-on (voice transcripts have no punctuation). */
export declare function lengthOf(text: string): string;
/** One note, end to end; the reply is built only from orion-brain's output. */
export declare function runNote({ message, exec }: {
    message: string;
    exec: NoteExec;
}): Promise<FlowResult>;
/** The real flow: scripts/orion-brain learn. Wired in by index.ts only. */
export declare const liveNoteFlow: (message: string) => Promise<FlowResult>;
