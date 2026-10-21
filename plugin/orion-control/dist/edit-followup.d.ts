/** start: where the block was written (HH:MM), so a second block of the same name is never the one changed. */
export type EditTarget = {
    kind: "block";
    title: string;
    dateArgs: string[];
    minutes?: number;
    start?: string;
    at: number;
} | {
    kind: "session";
    task: string;
    at: number;
};
export type EditRequest = {
    minutes?: number;
    delta?: number;
    direction?: "longer" | "shorter";
};
/** "make it an hour" -> { minutes: 60 }, "make it 30" -> { minutes: 30 }, "longer" -> { direction }, "make it 15 min longer" -> { delta: 15 }. */
export declare function parseEdit(message: string): EditRequest | undefined;
export declare const isEdit: (message: string) => boolean;
/** The block a calendar change just wrote, from its own call and output (what "make it an hour" means next). */
export declare function blockTarget(calls: string[], outputs: string[], at: number): EditTarget | undefined;
/** The new length for the block, or what to ask. */
export declare function editLength(req: EditRequest, current?: number): {
    minutes: number;
} | {
    ask: string;
};
export declare const SESSION_EDIT: (task: string) => string;
export declare const NOTHING_TO_EDIT = "Make what longer or shorter? I haven't changed anything. Tell me which block and how long it should be.";
/** No block made here to apply it to: asked, in code, never the worker's guess (review of 45b3383). */
export declare const whichOne: (req: EditRequest) => string;
