export type ShutdownTurn = {
    kind: "run";
} | {
    kind: "pass";
    minutes: number;
} | {
    kind: "override";
    on: boolean;
};
export type ShutdownCtx = {
    offered: boolean;
    night: boolean;
    armed: boolean;
};
/** ORION's offer, in both wordings of the firm rung (scripts/lib/life/sleep-nudge.mjs). */
export declare const isShutdownOffer: (text: string) => boolean;
export declare function readShutdownTurn(message: string, ctx: ShutdownCtx): ShutdownTurn | null;
