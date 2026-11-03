export type WorkoutTurn = {
    kind: "describe";
    text: string;
} | {
    kind: "answer";
    text: string;
} | {
    kind: "skip";
} | {
    kind: "cancel";
} | {
    kind: "undo";
    id: string;
};
/** The follow-up waiting in workout-pending.json, as the plugin sees it. */
export type WorkoutPendingView = {
    at: number;
    asked: number;
    question: string;
};
export type WorkoutContext = {
    now: Date;
    pending?: WorkoutPendingView;
    /** The question is still the last thing in this chat (WorkoutMemory.bound). */
    bound?: boolean;
    lastLogged?: {
        id: string;
        at: number;
    };
    /** The message is a reply to something ORION pushed (an outreach): a bare "went to the gym" is that check-in's answer, not a workout. */
    outreach?: boolean;
};
/** The workout turn in his message, or null. */
export declare function readWorkoutTurn(message: string, c: WorkoutContext): WorkoutTurn | null;
