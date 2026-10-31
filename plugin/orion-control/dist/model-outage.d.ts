export declare const OUTAGE_LINE = "My local model is down \u2014 I've saved your message and will act on it when it's back.";
export declare const doneWhileDown: (said: string) => string;
export declare const QUEUE_FILE = "pending-replay.jsonl";
export declare const UP_CACHE_MS = 15000;
export declare const REPLAY_MARK: RegExp;
export declare const replayText: (row: QueuedMessage, at: string) => string;
export type QueuedMessage = {
    id: string;
    at: string;
    sessionKey: string;
    message: string;
    spoken: boolean;
    state: "queued" | "replayed" | "failed";
    tries: number;
};
export type Probe = () => Promise<boolean>;
/** Ollama answers /api/version within `timeoutMs`. Never throws. */
export declare function probeOllama({ fetchImpl, baseUrl, timeoutMs }?: {
    fetchImpl?: typeof fetch;
    baseUrl?: string;
    timeoutMs?: number;
}): Promise<boolean>;
/** Up or down, with one warm-and-retry when down. "Up" is remembered for UP_CACHE_MS so a healthy turn costs nothing. */
export declare class ModelHealth {
    private readonly probe;
    private readonly warm;
    private readonly waitMs;
    private readonly clock;
    private upAt;
    constructor(probe: Probe, warm: () => Promise<unknown>, waitMs?: number, clock?: () => number);
    check(): Promise<boolean>;
    private mark;
}
/** The messages that arrived while the model was down, one JSON row each (rewritten as they are replayed). */
export declare class ReplayQueue {
    private readonly dir;
    constructor(dir: string);
    private get path();
    all(): QueuedMessage[];
    pending(): QueuedMessage[];
    add(row: {
        sessionKey: string;
        message: string;
        spoken: boolean;
    }, now?: Date): QueuedMessage;
    set(id: string, change: Partial<QueuedMessage>): void;
}
/** Replays what is queued once the model answers. A replay that fails three times is marked failed and left for a person. */
export declare function drainQueue(queue: ReplayQueue, health: {
    check: () => Promise<boolean>;
}, replay: (row: QueuedMessage) => Promise<boolean>): Promise<number>;
