export type FocusRow = Record<string, unknown>;
/** "is my focus session on / running / active": a yes-or-no about the session itself. */
export declare const asksFocusOn: (message: string) => boolean;
export declare const asksFocusToday: (message: string) => boolean;
export declare const HISTORY_FILE: string;
/** The focus history, one JSON object per line; bad lines are skipped. Read-only. */
export declare function readFocusHistory(file?: string): FocusRow[];
/** The local calendar day ("2026-10-16"), the same key orion-session writes (en-CA local date). */
export declare const localDayKey: (d: Date) => string;
/** Focused seconds of a session that is still going, from `orion-session status --json` (0 when none runs). */
export declare function liveFocusSeconds(statusStdout: string): number;
/**
 * Today's total. Same rule as scripts/lib/focus/day-total.mjs: every record of the day counts its
 * servedFocusSeconds, so an abandoned or early-ended session adds exactly the time it was actually
 * focused (never its planned length); a session under a minute (a start he took straight back) is not
 * counted as a session. A session still running counts its served seconds so far (it is not in the file yet).
 */
export declare function focusTodayTotal(rows: FocusRow[], dayKey: string, liveSeconds?: number): {
    seconds: number;
    sessions: number;
};
export declare function focusTodayReply(total: {
    seconds: number;
    sessions: number;
}): string;
/** q050: no session is running, so say the calendar block he is in, else the next one today, else that nothing is left. */
export declare function noSessionReply(dayText: string, nowHHMM: string): string;
