import type { FlowResult } from "./schedule-flow.js";
export type Preference = {
    fact: string;
    echo: string;
};
export type RememberRun = (args: string[]) => Promise<{
    stdout: string;
    code: number;
}>;
export declare const MAX_FACT = 80;
/** The preference(s) he stated in this message, or undefined. Pure. */
export declare function readPreference(message: string): Preference | undefined;
/** Writes it with orion-remember --user and answers from the result. Nothing is claimed unless the script says it was remembered. */
export declare function savePreference(pref: Preference, run: RememberRun): Promise<FlowResult>;
/** The real script (no shell, fixed arguments), beside orion-wake in the repo's scripts (ORION_SCRIPTS_DIR for a replay). Wired in by index.ts only. */
export declare const liveRememberRun: RememberRun;
