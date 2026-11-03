/*
 App turns carried out (w18 apps, 2026-11-03): apps-read.ts says what he meant, scripts/orion-apps does it, and every reply is the script's own
 sentence (its `say`): what was closed (helpers and force-stops named), what was kept and why, what is asking to save.

 Why this exists: on 2026-11-03 13:58 "close some of the apps that are open that im not using" made the local model call
 `orion-bedtime-act quit-app com.epicgames.Launcher` (a bedtime-only wrapper, bare name, not allowlisted) -> "exec denied: allowlist miss" ->
 "I can't quit apps directly". No policy gate was involved; the model reached for the wrong tool and had no way to list apps or pick the unused ones.
 Nothing here asks permission: closing an app is harmless (a document app still shows its own save prompt).
*/
import { execFile } from "node:child_process";
import type { AppsTurn } from "./apps-read.js";
import { scriptPath } from "./tool-guards.js";

export type AppsRun = (args: string[]) => Promise<{ stdout: string; code: number }>;
export type AppsOutcome = { text: string; calls: string[]; outputs: string[] };

/** Each app may wait ~5 s for a quit and ~3 s more for a forced one, all in parallel; this is the hard stop behind that. */
const RUN_TIMEOUT_MS = 60_000;

/** The real script. Wired in by index.ts only. */
export const liveAppsRun = (): AppsRun => (args) => new Promise((resolve) =>
  execFile(scriptPath("orion-apps"), args, { timeout: RUN_TIMEOUT_MS, maxBuffer: 1 << 20 },
    (e, stdout) => resolve({ stdout: String(stdout ?? ""), code: e ? (typeof e.code === "number" ? e.code : 1) : 0 })));

type Json = { ok?: boolean; error?: string; say?: string };
const parse = (stdout: string): Json => { try { return JSON.parse(stdout.trim().split("\n").at(-1) ?? "") as Json; } catch { return { ok: false, error: "orion-apps gave no answer" }; } };

/** The commands one turn runs, in order. An "unused" turn that named examples closes those first. */
export function argsFor(turn: AppsTurn): string[][] {
  switch (turn.kind) {
    case "list": return [["list", "--json"]];
    case "quit": return [["quit", ...turn.names, "--json"]];
    case "hide": return [["hide", turn.name, "--json"]];
    case "except": return [["quit-unused", "--all", "--keep", turn.keep.join(","), "--json"]];
    case "unused": return [...(turn.also.length ? [["quit", ...turn.also, "--json"]] : []), ["quit-unused", "--json"]];
  }
}

/** Carries out one apps turn. Never throws; a failure is one honest sentence. */
export async function runAppsTurn(turn: AppsTurn, deps: { run: AppsRun }): Promise<AppsOutcome> {
  const calls: string[] = [], outputs: string[] = [], says: string[] = [];
  for (const args of argsFor(turn)) {
    const r = await deps.run(args).catch((e: unknown) => ({ stdout: JSON.stringify({ ok: false, error: String(e) }), code: 1 }));
    const j = parse(r.stdout);
    calls.push(`orion-apps ${args.join(" ")}`); outputs.push(r.stdout.trim().slice(0, 2000));
    says.push(typeof j.say === "string" && j.say ? j.say : `I couldn't reach your apps just now${j.error ? ` (${j.error})` : ""}, so nothing was closed.`);
  }
  return { text: says.join(" "), calls, outputs };
}
