export type QuestionRow = {
    id: string;
    q: string;
    why?: string;
    topic?: string;
    priority?: "high" | "normal" | "low";
    status: string;
    created?: string;
    askedAt?: string | null;
    askCount?: number;
    askedVia?: "push" | "chat";
    askedText?: string;
    answer?: string | null;
    answeredAt?: string;
    fact?: string;
};
/** questions.jsonl, or eval-questions.jsonl while a sandboxed evaluation runs (the scripts' rule, plugin-clock.ts). */
export declare const questionsFile: (stateDir: string, realNow?: () => number) => string;
export declare function readQuestionRows(path: string): QuestionRow[];
/** Open questions in the order they would be asked: never-asked first, then priority, then oldest. */
export declare const openRows: (rows: QuestionRow[]) => QuestionRow[];
export declare const PUSH_ANSWER_MS: number;
export declare const CHAT_ANSWER_MS: number;
/**
 The question his message may answer: asked and unanswered, newest first. A push binds for 3 h, and only while it is still the last thing
 ORION sent (the app's label names it, or the card's last push is it); a question listed in chat binds for 30 min.
*/
export declare function awaitingRow(rows: QuestionRow[], now: Date, seen: {
    label?: string;
    lastPush?: {
        text: string;
        at: string;
    } | null;
}): QuestionRow | undefined;
/** "He answered your questions: Who is Sam? → my gym buddy; …" for the state card: the newest three in 30 days. Pure. */
export declare function answeredLine(rows: QuestionRow[], now: Date, max?: number): string;
/** The card line from the state dir, or "" (never throws). */
export declare function answeredCardLine(stateDir: string | undefined, now: Date): string;
