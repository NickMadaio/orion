import * as nodeFs from "node:fs";
export declare const RELAY_ACTIONS: ReadonlySet<string>;
export declare const RELAY_PAYLOAD_KEYS: ReadonlySet<string>;
export declare const RELAY_LIMITS: {
    readonly maxPayloadKeys: 16;
    readonly maxValueBytes: number;
    readonly maxRequestBytes: number;
    readonly maxResponseBytes: number;
    readonly heartbeatFreshMs: 15000;
    readonly timeoutMs: 20000;
    readonly pollMs: 100;
    readonly keyBytes: 32;
};
export type RelayPaths = {
    readonly dir: string;
    readonly keyPath: string;
    readonly heartbeatPath: string;
};
export declare function relayPaths(controlledDir?: string): RelayPaths;
export type RelayErrorKind = "app_down" | "app_untrusted" | "no_bridge" | "unsafe" | "refused" | "timeout" | "bad_response";
export declare class RelayError extends Error {
    readonly kind: RelayErrorKind;
    constructor(kind: RelayErrorKind, message: string);
}
export type RelayRequestFields = {
    readonly id: string;
    readonly action: string;
    readonly createdAt: number;
    readonly nonce: string;
    readonly payload: Readonly<Record<string, string>>;
};
export type RelayResponseFields = {
    readonly id: string;
    readonly nonce: string;
    readonly ok: boolean;
    readonly error?: string | null;
    readonly result?: Readonly<Record<string, string>>;
};
export declare function canonicalRequest(r: RelayRequestFields): string;
export declare function canonicalResponse(r: RelayResponseFields): string;
export declare function sign(key: Buffer, canonical: string): string;
export declare function verifyMac(key: Buffer, canonical: string, presented: unknown): boolean;
type Fs = Pick<typeof nodeFs, "mkdirSync" | "lstatSync" | "readFileSync" | "writeFileSync" | "renameSync" | "unlinkSync" | "linkSync" | "existsSync">;
/** Creates the relay directory (0700) if missing and refuses one that is a symlink, someone else's, or loose. */
export declare function ensureRelayDir(paths: RelayPaths, fs?: Fs): void;
/** The 32-byte HMAC key, generated once (0600, created atomically so two processes cannot both write it). */
export declare function ensureRelayKey(paths: RelayPaths, fs?: Fs, random?: (n: number) => Buffer): Buffer;
export type AppState = "ready" | "untrusted" | "no_bridge" | "down";
/** Whether Orion.app is running the relay right now, from its heartbeat (written every 5 s). */
export declare function relayAppState(paths: RelayPaths, now?: number, fs?: Fs): AppState;
export type RelayOptions = {
    readonly paths?: RelayPaths;
    readonly fs?: Fs;
    readonly now?: () => number;
    readonly sleep?: (ms: number) => Promise<void>;
    readonly timeoutMs?: number;
    readonly pollMs?: number;
    readonly newId?: () => string;
    readonly newNonce?: () => string;
};
export type BridgeAnswer = {
    readonly ok: boolean;
    readonly error?: string;
    readonly result: Record<string, string>;
};
/**
 * Sends one allowlisted bridge request through Orion.app and returns the bridge's answer (ok or not).
 * Throws RelayError only for the relay itself: refused locally, nobody answering, or an answer that doesn't verify.
 */
export declare function relayRequest(action: string, payload: Readonly<Record<string, string>>, options?: RelayOptions): Promise<BridgeAnswer>;
export {};
