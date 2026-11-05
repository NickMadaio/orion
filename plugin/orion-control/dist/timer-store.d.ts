import type { Reminder } from "./ambient.js";
export declare function addTimerEntry(file: string, seconds: number, label: string, now?: number): Promise<Reminder>;
/** One plain one-off reminder, the entry orion_task_run's alarm_set writes (executors.ts), so the app's clock fires it. */
export declare function addReminderEntry(file: string, dueAt: number, label: string, important?: boolean, now?: number): Promise<Reminder>;
