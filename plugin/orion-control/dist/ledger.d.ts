import type { TaskRunRecord } from "./types.js";
export declare class TaskLedger {
    private readonly filePath;
    constructor(filePath: string);
    append(record: TaskRunRecord): Promise<void>;
    /**
     * Append without letting an audit failure destroy the caller's result. The
     * outcome is returned so a failed audit write is surfaced to the caller
     * instead of being swallowed or replacing the run result with an exception.
     */
    appendReporting(record: TaskRunRecord): Promise<{
        appended: boolean;
        error?: string;
    }>;
    find(taskId: string): Promise<TaskRunRecord | undefined>;
}
