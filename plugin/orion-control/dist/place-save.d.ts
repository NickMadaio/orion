export type PlaceReply = {
    kind: "name";
    name: string;
    alias?: string;
} | {
    kind: "yes";
} | {
    kind: "no";
};
export type PlacePending = {
    stage: "confirm" | "name";
    name?: string;
    at: number;
};
/** ORION's own question about saving where he is (the proactive one, or a follow-up). */
export declare const asksToSavePlace: (text: string) => boolean;
/** His answer to ORION's question about a place: a name, a yes, a no, or null (something else entirely). */
export declare function readPlaceReply(message: string, pending?: PlacePending): PlaceReply | null;
/** The place id for a name: lowercase, dashes. */
export declare const placeId: (name: string) => string;
/** The name a model-drafted question carries ("Got it, Chapter Spitalfields. Want me to save that spot for you?"), or undefined. */
export declare function nameInQuestion(reply: string): string | undefined;
export declare const placeAskName = "Sure. What should I call it?";
export declare const placeDeclined = "Okay, I won't save it.";
export declare const placeSaved: (name: string) => string;
export declare const placeFailed: (why: string) => string;
