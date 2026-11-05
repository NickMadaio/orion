import type { LiveHooks } from "./turn.js";
/** "orion-reschedule move \"Gym\" --to 19:00" -> ["orion-reschedule", "move", "Gym", "--to", "19:00"] (quotes only; no shell). */
export declare const words: (line: string) => string[];
export type LiveModels = {
    desk: string;
    worker: string;
};
export declare function liveHooks(models: LiveModels, day?: LiveHooks["day"]): LiveHooks;
/** Loads a model at the context it is called with, so the first measured turn is not a cold start. */
export declare function warm(model: string, numCtx: number): Promise<void>;
export declare const warmModels: (m: LiveModels) => Promise<void>;
export type Resident = {
    name: string;
    gib: number;
    vramGib: number;
    ctx: number;
};
/** What Ollama says is loaded right now (resident size includes the KV cache at the context in use). */
export declare function resident(): Promise<Resident[]>;
