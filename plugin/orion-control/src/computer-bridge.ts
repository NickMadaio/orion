/**
 * The computer loop's hands (2026-10-30): one OrionMacBridge request per call, plus `open` for apps.
 *
 * The bridge's own guards run on every call (Accessibility trusted, screen unlocked, the frontmost app is the one
 * named, nothing on the sensitive-content denylist, and for press/set-value the element at the path is still the
 * role and label that was observed). This file only translates; it decides nothing.
 *
 * macOS grants Accessibility to the RESPONSIBLE process: from the gateway that is the gateway's node binary, from a
 * terminal the terminal app. A missing grant comes back as a `no_access` failure, never as a pretend success.
 */
import { spawn } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import type { Observation, AxNode } from "./computer-ax.js";
import type { AppRef } from "./computer-intent.js";

export type ElementRef = { readonly path: string; readonly role: string; readonly label: string | null };

export type FailureKind = "no_access" | "no_screen_recording" | "denied" | "locked" | "mismatch" | "stale" | "not_found" | "other";

export class BridgeFailure extends Error {
  constructor(readonly kind: FailureKind, message: string) {
    super(message);
    this.name = "BridgeFailure";
  }
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
  ocr?(): Promise<{ appName: string; windowTitle: string | null; lines: string[] }>;
}

export const DEFAULT_BRIDGE = join(homedir(), "Desktop/ORION/native/OrionMacBridge/.build/release/orion-mac-bridge");

export function classifyFailure(message: string): FailureKind {
  if (/Accessibility is not granted/i.test(message)) return "no_access";
  if (/Screen Recording is not granted/i.test(message)) return "no_screen_recording";
  if (/denylist|Refused: /i.test(message)) return "denied";
  if (/locked/i.test(message)) return "locked";
  if (/frontmost app changed/i.test(message)) return "mismatch";
  if (/changed since it was observed/i.test(message)) return "stale";
  if (/No element at path|No menu item|No matching|disabled/i.test(message)) return "not_found";
  return "other";
}

type Run = (file: string, args: readonly string[], input: string, timeoutMs: number) => Promise<{ stdout: string; stderr: string; code: number | null }>;

const defaultRun: Run = (file, args, input, timeoutMs) => new Promise((resolve, reject) => {
  const child = spawn(file, [...args], { stdio: ["pipe", "pipe", "pipe"] });
  let stdout = "";
  let stderr = "";
  const timer = setTimeout(() => child.kill("SIGKILL"), timeoutMs);
  child.stdout.on("data", (chunk) => { stdout += String(chunk); });
  child.stderr.on("data", (chunk) => { stderr += String(chunk); });
  child.on("error", (error) => { clearTimeout(timer); reject(error); });
  child.on("close", (code) => { clearTimeout(timer); resolve({ stdout, stderr, code }); });
  child.stdin.end(input);
});

function parseObservation(result: Record<string, string>): Observation {
  let nested: { window_title?: string | null; element?: AxNode | null; truncated?: boolean } = {};
  try { nested = JSON.parse(result.observation_json ?? "{}"); } catch { nested = {}; }
  return {
    appName: result.app_name ?? "",
    bundleId: result.bundle_id ?? "",
    windowTitle: nested.window_title ?? null,
    element: nested.element ?? null,
    truncated: result.truncated === "true",
  };
}

function parseList(raw: string | undefined): string[] {
  try {
    const value: unknown = JSON.parse(raw ?? "[]");
    return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
  } catch { return []; }
}

export function createMacBridge({ binary = DEFAULT_BRIDGE, run = defaultRun, timeoutMs = 20_000 }: { binary?: string; run?: Run; timeoutMs?: number } = {}): ComputerBridge {
  const ask = async (action: string, payload: Record<string, string> = {}): Promise<Record<string, string>> => {
    const request = `${JSON.stringify({ id: String(Date.now()), action, payload })}\n`;
    let out: Awaited<ReturnType<Run>>;
    try { out = await run(binary, [], request, timeoutMs); } catch (error) {
      throw new BridgeFailure("other", `the screen bridge did not start: ${String((error as Error).message ?? error).slice(0, 200)}`);
    }
    const line = out.stdout.split("\n").find((l) => l.trim().startsWith("{"));
    if (!line) throw new BridgeFailure("other", (out.stderr.trim() || `the screen bridge exited ${out.code}`).slice(0, 240));
    let parsed: { ok?: boolean; error?: string; result?: Record<string, string> };
    try { parsed = JSON.parse(line); } catch { throw new BridgeFailure("other", "the screen bridge returned malformed JSON"); }
    if (!parsed.ok) {
      const message = parsed.error ?? "the screen bridge reported an unspecified failure";
      throw new BridgeFailure(classifyFailure(message), message);
    }
    return parsed.result ?? {};
  };
  const ref = (r: ElementRef) => ({ path: r.path, role: r.role, ...(r.label ? { label: r.label } : {}) });
  return {
    observe: async () => parseObservation(await ask("screen_observe")),
    openApp: async (app) => {
      const args = app.bundleId ? ["-b", app.bundleId] : ["-a", app.name];
      const out = await run("/usr/bin/open", args, "", 15_000).catch((e: Error) => ({ stdout: "", stderr: e.message, code: 1 }));
      if (out.code !== 0) throw new BridgeFailure("not_found", `couldn't open ${app.name}: ${out.stderr.trim().slice(0, 160)}`);
    },
    press: async (bundleId, r, axAction) => { await ask("screen_press", { expected_bundle_id: bundleId, ...ref(r), ...(axAction ? { ax_action: axAction } : {}) }); },
    setValue: async (bundleId, r, value) => { await ask("screen_set_value", { expected_bundle_id: bundleId, ...ref(r), value }); },
    menu: async (bundleId, path) => { await ask("screen_menu", { expected_bundle_id: bundleId, menu_path: path.join(">") }); },
    menuItems: async (bundleId, menu) => parseList((await ask("screen_menu_items", { expected_bundle_id: bundleId, menu })).items_json),
    key: async (bundleId, name) => { await ask("screen_key", { expected_bundle_id: bundleId, key: name }); },
    type: async (bundleId, text) => { await ask("screen_type", { expected_bundle_id: bundleId, text }); },
    click: async (bundleId, x, y) => { await ask("screen_click", { expected_bundle_id: bundleId, x: String(Math.round(x)), y: String(Math.round(y)) }); },
    ocr: async () => {
      const result = await ask("screen_ocr");
      return { appName: result.app_name ?? "", windowTitle: result.window_title || null, lines: parseList(result.lines_json) };
    },
  };
}
