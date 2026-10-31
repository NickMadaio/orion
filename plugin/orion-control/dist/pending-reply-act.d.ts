import type { PendingDeps, PendingOutcome, PendingTurn } from "./pending-reply.js";
export declare function runTurn(turn: PendingTurn, deps: PendingDeps): Promise<PendingOutcome | undefined>;
