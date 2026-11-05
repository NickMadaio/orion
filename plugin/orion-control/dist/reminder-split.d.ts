import type { Reminder } from "./ambient.js";
import { type Extracted, type StoredReminder } from "./reminder-flow.js";
/** A reminder clause and the message left. The reminder's own words run to a sentence break, "also", "then" or a question (ask-clauses.ts), never to a plain "and". */
export declare function splitReminderAsk(message: string): {
    clause: string;
    rest: string;
} | undefined;
export type ReminderDeps = {
    now: Date;
    extract: (message: string) => Promise<Extracted>;
    list: () => Promise<StoredReminder[]>;
    add: (dueAt: number, label: string, important: boolean) => Promise<Reminder>;
};
export type ReminderClauseOutcome = {
    text: string;
    calls: string[];
    outputs: string[];
    ok: boolean;
};
/** Sets the reminders the clause asks for and says so from the store; undefined when the planner would not set a plain one-off (the whole message goes on as before). */
export declare function runReminderClause(clause: string, deps: ReminderDeps): Promise<ReminderClauseOutcome | undefined>;
