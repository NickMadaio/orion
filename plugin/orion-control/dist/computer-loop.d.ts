/**
 * Computer use from the local chat route (2026-10-30): observe -> act -> verify on the real screen.
 *
 * Before this, every computer-use turn on the local route got "I can't click buttons / can't see your screen":
 * the 9B's slim prompt never offered the tools, and the catalog's screen_click/type/key need a human-approved
 * exact-args hash per action. This is a code-built flow like the route's others. It claims a turn only when
 * computer-intent.ts reads a computer task in Nick's own words, runs the deterministic recipes in
 * computer-recipes.ts against OrionMacBridge (AX actions first), and replies with what really happened.
 *
 * Authorization: computer-auth.ts (his explicit request is the permission for its reversible steps; irreversible
 * and unnamed stops and asks; his "yes" to that question resumes from that step). Taint: screen text is matched
 * against his words and never adds a step.
 *
 * Wiring (orchestrator): call `maybeRunComputerTask({ message: run.message, sessionKey }, deps)` with
 * `enabled.control` = the `computer_control` tier being on (enableComputerControlActions + external_connected),
 * and use `reply` as the turn's reply when it returns non-null.
 */
import { type ComputerBridge } from "./computer-bridge.js";
import { type ComputerIntent } from "./computer-intent.js";
import { type StepLog } from "./computer-recipes.js";
export type { StepLog } from "./computer-recipes.js";
export type ComputerTurn = {
    readonly message: string;
    readonly sessionKey?: string;
};
export type ComputerDeps = {
    readonly bridge: ComputerBridge;
    /** The computer_observe / computer_control tiers as configured. Off means an honest line and no bridge call. */
    readonly enabled: {
        readonly observe: boolean;
        readonly control: boolean;
    };
    /** One short line per step for voice ("opening TextEdit"); wire to turn-progress. */
    readonly progress?: (line: string) => void;
    /** The worker picks among tied candidates BY NUMBER (1-based); anything else is ignored. */
    readonly pick?: (want: string, lines: string[]) => Promise<number | null>;
    /** The worker answers a screen question from screenPrompt(); no tools. */
    readonly summarize?: (prompt: string) => Promise<string>;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly now?: () => number;
    readonly maxSteps?: number;
    readonly pending?: Map<string, Pending>;
};
export type ComputerResult = {
    readonly handled: true;
    readonly reply: string;
    readonly steps: readonly StepLog[];
};
type ActIntent = Extract<ComputerIntent, {
    kind: "act";
}>;
export type Pending = {
    readonly intent: ActIntent;
    readonly clauseIndex: number;
    readonly confirmKey: string;
    readonly at: number;
};
export declare const MAX_STEPS = 12;
export declare function resetComputerPending(): void;
/**
 * The one entry point. Null means "not a computer task": the route carries on as before. `turn.message` must be
 * Nick's own live turn; it is the only text that can authorise anything.
 */
export declare function maybeRunComputerTask(turn: ComputerTurn, deps: ComputerDeps): Promise<ComputerResult | null>;
