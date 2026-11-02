import type { FlowResult } from "./schedule-flow.js";
import { type Group, type PhoneBlockRead, type Span } from "./phone-block-read.js";
export type PhoneTimeRun = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export type PhoneTool = {
    canonical: string;
    stdout: string;
    exit: number;
};
export type PhoneOutcome = {
    flow: FlowResult;
    tools: PhoneTool[];
    wrote: boolean;
};
/** The real script, beside orion-wake (ORION_SCRIPTS_DIR for a replay). Wired in by index.ts only. */
export declare const livePhoneTimeRun: PhoneTimeRun;
/** His next wake alarm from wake-plan.json (the plan's own file, in the state dir); undefined when there is none. */
export declare function wakeAtFromPlan(stateDir: string | undefined, now: Date): Date | undefined;
/** Blocks `groups` for a span. A length over the limit, or a run that fails, blocks nothing and says so. */
export declare function blockGroups(opts: {
    groups: Group[];
    apps: string[];
    span?: Span;
    all?: boolean;
    distractions?: boolean;
    run: PhoneTimeRun;
    now: Date;
    wake?: () => Date | undefined;
}): Promise<PhoneOutcome>;
/** Opens groups again (or everything ORION shut). The reply says what the script said happened. */
export declare function unblockGroups(opts: {
    groups: Group[] | "all";
    apps: string[];
    run: PhoneTimeRun;
}): Promise<PhoneOutcome>;
/** The whole route for a read request: block, unblock, or the one short question. */
export declare function runPhoneBlock(read: PhoneBlockRead, deps: {
    run: PhoneTimeRun;
    now?: Date;
    stateDir?: string;
}): Promise<PhoneOutcome>;
