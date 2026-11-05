import type { Decision } from "./front-desk.js";
import type { FoodRun } from "./food-chat.js";
import type { LedgerRun } from "./ledger-run.js";
import type { SelffixRun } from "./selffix-flow.js";
import type { FlowResult } from "./schedule-flow.js";
import type { ChatDeps } from "./chat-asks.js";
export declare const NOW: Date;
export type Rig = {
    turn: (prompt: string) => Promise<string | undefined>;
    dir: string;
    flows: string[];
    fire: (n: string, e: Record<string, unknown>, c: Record<string, unknown>) => Promise<unknown[]>;
    setClock: (ms: number) => void;
};
export type RigOptions = {
    foodRun?: FoodRun;
    ledgerRun?: LedgerRun;
    selffixRun?: SelffixRun;
    noteFlow?: (m: string, b?: boolean) => Promise<FlowResult>;
    chatRun?: ChatDeps;
    todoDoneFlow?: (m: string) => Promise<FlowResult>;
    health?: object;
    decide?: Decision;
    scheduleFlow?: (m: string) => Promise<FlowResult>;
};
/** A chat session; `turn` returns the direct reply when code owns it, else the drafted system prompt text (what the worker is told to say). */
export declare function rig(o: RigOptions): Rig;
