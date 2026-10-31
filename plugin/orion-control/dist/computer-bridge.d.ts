import type { Observation } from "./computer-ax.js";
import type { AppRef } from "./computer-intent.js";
import { type AppState, type BridgeAnswer } from "./computer-relay.js";
export type ElementRef = {
    readonly path: string;
    readonly role: string;
    readonly label: string | null;
};
export type FailureKind = "no_access" | "app_down" | "no_screen_recording" | "denied" | "locked" | "mismatch" | "stale" | "not_found" | "other";
export declare class BridgeFailure extends Error {
    readonly kind: FailureKind;
    constructor(kind: FailureKind, message: string);
}
export interface ComputerBridge {
    observe(): Promise<Observation>;
    openApp(app: AppRef): Promise<void>;
    press(bundleId: string, ref: ElementRef, axAction?: string): Promise<void>;
    setValue(bundleId: string, ref: ElementRef, value: string): Promise<void>;
    menu(bundleId: string, path: readonly string[]): Promise<void>;
    menuItems(bundleId: string, menu: string): Promise<string[]>;
    key(bundleId: string, name: string): Promise<void>;
    type(bundleId: string, text: string): Promise<void>;
    click(bundleId: string, x: number, y: number): Promise<void>;
    ocr?(): Promise<{
        appName: string;
        windowTitle: string | null;
        lines: string[];
    }>;
}
export declare const DEFAULT_BRIDGE: string;
export declare function classifyFailure(message: string): FailureKind;
/** How requests reach Orion.app's relay. `state` reads the app's heartbeat; `send` carries one request. */
export type RelayTransport = {
    readonly state: () => AppState;
    readonly send: (action: string, payload: Record<string, string>) => Promise<BridgeAnswer>;
};
export declare const defaultRelay: () => RelayTransport;
type Run = (file: string, args: readonly string[], input: string, timeoutMs: number) => Promise<{
    stdout: string;
    stderr: string;
    code: number | null;
}>;
export declare function createMacBridge({ binary, run, timeoutMs, relay }?: {
    binary?: string;
    run?: Run;
    timeoutMs?: number;
    /** Orion.app's relay; `null` always spawns the bridge directly (no heartbeat read). */
    relay?: RelayTransport | null;
}): ComputerBridge;
export {};
