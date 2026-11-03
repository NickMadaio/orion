export type MousePending = {
    ask: "button" | "action";
    button?: string;
    action?: string;
    app?: string;
    clear?: boolean;
};
export type MouseTurn = {
    kind: "status";
} | {
    kind: "set";
    button: string;
    action: string;
    app?: string;
} | {
    kind: "clear";
    button: string;
    app?: string;
} | {
    kind: "passthrough";
    op: "add" | "remove";
    app: string;
} | {
    kind: "games";
    state: "on" | "off";
} | {
    kind: "setup";
} | {
    kind: "apply";
} | {
    kind: "decline";
} | {
    kind: "cancel";
};
export type MouseContext = {
    /** ORION asked for a button or an action and nothing else was said since (MouseMemory). */
    pending?: MousePending;
    /** ORION listed the suggested defaults and is waiting for a yes. */
    confirm?: boolean;
    /** The message answers an outreach about a new mouse. */
    outreachAbout?: boolean;
};
/** The mouse turn in his message, or null. */
export declare function readMouseTurn(message: string, c?: MouseContext): MouseTurn | null;
