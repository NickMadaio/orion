/** Collateral changes the scheduler printed ("x 9:00 AM → 10:00 AM", "Gym is off today") as one or two short sentences. */
export declare function knockOn(notes: string[]): string;
export type Compound = {
    did: string[];
    knock: string[];
    couldnt: string[];
    tail?: string;
    undo: boolean;
};
/** Done first, then what it shifted, then what could not happen, then (a few words) how to revert. */
export declare function compoundReply(p: Compound): string;
