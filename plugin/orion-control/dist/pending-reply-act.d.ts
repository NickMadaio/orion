import type { Day, FlowResult } from "./schedule-flow.js";
import type { ToolResult } from "./work-check.js";
import type { Memo, PendingDeps, PendingOutcome, PendingTurn } from "./pending-reply.js";
import { type Which } from "./pending-reply-day.js";
type Acc = {
    tools: ToolResult[];
    marks: string[];
    wrote: boolean;
};
export declare class Ctx {
    readonly deps: PendingDeps;
    readonly turn: PendingTurn;
    readonly acc: Acc;
    constructor(deps: PendingDeps, turn: PendingTurn);
    get now(): Date;
    get nowMin(): number;
    day(which: Which): Promise<Day | undefined>;
    /** `lengthSaid`: the length in the command is Nick's own words (it beats his saved minimums); any other length is ORION's default. */
    schedule(command: string, lengthSaid?: boolean): Promise<FlowResult | undefined>;
    checkin(args: string[]): Promise<{
        stdout: string;
        code: number;
    } | undefined>;
    /** The ONE open plan loop about `what`, by id (orion-checkin find); undefined for none or several. */
    loopId(what: string): Promise<string | undefined>;
    /** Comes back in `minutes` about `what`: the open loop is deferred (no second ladder), else a new check-in. Returns when, or undefined. */
    comeBack(what: string, minutes: number, because: string): Promise<{
        at: number;
        id?: string;
        refused?: boolean;
    } | undefined>;
    /** After a write: the start the calendar now shows for `title` (REV4 8: a reply about a time says the calendar's time, not the asked one). */
    readBack(which: Which, title: string, asked: number): Promise<number | undefined>;
    done(text: string, memo: Memo | null): PendingOutcome;
}
export declare function runTurn(turn: PendingTurn, deps: PendingDeps): Promise<PendingOutcome | undefined>;
export {};
