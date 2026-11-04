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
export declare const NOTE_ASK = "Go ahead \u2014 what's the note?";
/** How long the next message is read as the note after a bare request. */
export declare const NOTE_WINDOW_MS: number;
export declare function isBareNoteRequest(message: string): boolean;
export declare const isOtherCommand: (message: string) => boolean;
/** Sentences in his text: ". ! ?" runs and line breaks end one; a run-on with no punctuation is one. */
export declare function countSentences(text: string): number;
/** "4 sentences", or the word count for one long run-on (voice transcripts have no punctuation). */
export declare function lengthOf(text: string): string;
/** One note, end to end; the reply is built only from orion-brain's output. */
export declare function runNote({ message, exec, bound }: {
    message: string;
    exec: NoteExec;
    bound?: boolean;
}): Promise<FlowResult>;
/** The real flow: scripts/orion-brain learn. Wired in by index.ts only. */
export declare const liveNoteFlow: (message: string, bound?: boolean) => Promise<FlowResult>;
