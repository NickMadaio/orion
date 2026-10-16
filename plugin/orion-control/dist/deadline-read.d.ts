export type DeadlineEvent = {
    title: string;
    start: string;
    allDay?: string;
    isDeadline?: boolean;
};
export type DeadlineTask = {
    title: string;
    due: string;
};
/** tasksFailed: `orion-tasks list` failed, so no to-do is known (r8 review 2026-10-16 M3). */
export type DeadlineRead = {
    events: DeadlineEvent[];
    tasks: DeadlineTask[];
    tasksFailed?: boolean;
};
/**
 * A question about what is due; a change ("make the essay due friday") is not one. The question form needs a real question
 * (`question`: a "?" or a question opener, "i wonder what's due" is neither); only a bare noun phrase passes without one.
 */
export declare const asksDeadlines: (message: string, question?: boolean) => boolean;
/** The spoken answer to "what's due …" from the read. */
export declare function deadlineReply(message: string, read: DeadlineRead, today: Date): string;
/** Dated open to-dos from `orion-tasks list` ("- title · due 2026-10-17 · medium"). */
export declare function parseTasks(stdout: string): DeadlineTask[];
/** Reads the calendar's deadlines and the dated to-dos (read-only); null when the calendar read fails, so the worker takes over. */
export declare function liveReadDeadlines(): Promise<DeadlineRead | null>;
