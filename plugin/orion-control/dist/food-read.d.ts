import type { MealRead } from "./health-log.js";
export type FoodTurn = {
    kind: "ask";
    text: string;
} | {
    kind: "that";
} | {
    kind: "log";
    text: string;
} | {
    kind: "meal";
    read: MealRead;
} | {
    kind: "photo";
} | {
    kind: "yes";
} | {
    kind: "no";
} | {
    kind: "revise";
    correction: string;
} | {
    kind: "undo";
    id: string;
};
/** The offer waiting in food-pending.json, as the plugin sees it. */
export type FoodPendingView = {
    at: number;
    via: "chat" | "inbox";
    offerText: string;
};
export type FoodContext = {
    now: Date;
    /** Whether a meal statement may be sized (the runner is wired). */
    mealsOn: boolean;
    pending?: FoodPendingView;
    /** The offer is still the last thing in this chat (FoodMemory.bound). */
    bound?: boolean;
    attachments?: ReadonlyArray<{
        kind?: string;
    }>;
    lastLogged?: {
        id: string;
        at: number;
    };
};
/** The food turn in his message, or null. */
export declare function readFoodTurn(message: string, c: FoodContext): FoodTurn | null;
