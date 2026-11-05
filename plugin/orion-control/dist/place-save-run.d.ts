import { type PlacePending, type PlaceReply } from "./place-save.js";
export type PlaceRun = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type PlaceOutcome = {
    text: string;
    calls: string[];
    outputs: string[];
    pending?: PlacePending;
};
/** His reply, the name already known (from the pending item or the question), and the runner. */
export declare function runPlaceTurn(reply: PlaceReply, known: {
    name?: string;
    stage?: PlacePending["stage"];
}, run: PlaceRun, now: number): Promise<PlaceOutcome>;
