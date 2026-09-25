export declare const TASK_ID: RegExp;
export declare function actionsDirectory(ledgerPath: string): string;
export declare function markRunning(ledgerPath: string, entry: {
    taskId: string;
    goal: string;
    actions: string[];
    startedAt: string;
    commands?: string[];
}): Promise<void>;
export declare function cancelRequested(ledgerPath: string, taskId: string): boolean;
export declare function clearRun(ledgerPath: string, taskId: string): Promise<void>;
