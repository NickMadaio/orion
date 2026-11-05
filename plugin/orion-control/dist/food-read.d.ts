import type { MealRead } from "./health-log.js";
export type FoodTurn = {
    kind: "ask";
    text: string;
    question?: string;
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
    question?: string;
} | {
    kind: "yes";
} | {
    kind: "pick";
    which: string;
} | {
    kind: "no";
    which?: string;
} | {
    kind: "revise";
    correction: string;
    which?: string;
} | {
    kind: "undo";
    id: string;
    ids?: string[];
};
/** The offer waiting in food-pending.json, as the plugin sees it. */
export type FoodPendingView = {
    at: number;
    via: "chat" | "inbox";
    offerText: string;
    count?: number;
    names?: string[];
    loggedId?: string;
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
        ids?: string[];
        at: number;
    };
    /** The food ORION just answered a question about (the offer lives in this chat, not in food-pending.json: a gate / evaluation run never writes that file). Already bound. */
    chatOffer?: {
        food: string;
    };
};
/** The food turn in his message, or null. */
export declare function readFoodTurn(message: string, c: FoodContext): FoodTurn | null;
