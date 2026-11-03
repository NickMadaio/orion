/*
 App turns carried out (w18 apps, 2026-11-03): apps-read.ts says what he meant, scripts/orion-apps does it, and every reply is the script's own
 sentence (its `say`): what was closed (helpers and force-stops named), what was kept and why, what is asking to save.

 Why this exists: on 2026-11-03 13:58 "close some of the apps that are open that im not using" made the local model call
 `orion-bedtime-act quit-app com.epicgames.Launcher` (a bedtime-only wrapper, bare name, not allowlisted) -> "exec denied: allowlist miss" ->
 "I can't quit apps directly". No policy gate was involved; the model reached for the wrong tool and had no way to list apps or pick the unused ones.
 Nothing here asks permission: closing an app is harmless (a document app still shows its own save prompt).
*/
import { execFile } from "node:child_process";
import { scriptPath } from "./tool-guards.js";
/** Each app may wait ~5 s for a quit and ~3 s more for a forced one, all in parallel; this is the hard stop behind that. */
const RUN_TIMEOUT_MS = 60_000;
/** The real script. Wired in by index.ts only. */
export const liveAppsRun = () => (args) => new Promise((resolve) => execFile(scriptPath("orion-apps"), args, { timeout: RUN_TIMEOUT_MS, maxBuffer: 1 << 20 }, (e, stdout) => resolve({ stdout: String(stdout ?? ""), code: e ? (typeof e.code === "number" ? e.code : 1) : 0 })));
const parse = (stdout) => { try {
    return JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
}
catch {
    return { ok: false, error: "orion-apps gave no answer" };
} };
/** The commands one turn runs, in order. An "unused" turn that named examples closes those first. */
export function argsFor(turn) {
    switch (turn.kind) {
        case "list": return [["list", "--json"]];
        case "quit": return [["quit", ...turn.names, "--json"]];
        case "hide": return [["hide", turn.name, "--json"]];
        case "except": return [["quit-unused", "--all", "--keep", turn.keep.join(","), "--json"]];
        case "gameMode": return turn.on ? [["game-prep", "auto", "on", "--json"], ["game-prep", "--json"]] : [["game-prep", "auto", "off", "--json"]];
        case "gameKeep": return [["game-prep", "keep", turn.op, ...turn.names, "--json"]];
        case "gameLast": return [["game-prep", "last", "--json"]];
        case "unused": return [...(turn.also.length ? [["quit", ...turn.also, "--json"]] : []), ["quit-unused", "--json"]];
    }
}
/** Carries out one apps turn. Never throws; a failure is one honest sentence. */
export async function runAppsTurn(turn, deps) {
    const calls = [], outputs = [], says = [];
    for (const args of argsFor(turn)) {
        const r = await deps.run(args).catch((e) => ({ stdout: JSON.stringify({ ok: false, error: String(e) }), code: 1 }));
        const j = parse(r.stdout);
        calls.push(`orion-apps ${args.join(" ")}`);
        outputs.push(r.stdout.trim().slice(0, 2000));
        says.push(typeof j.say === "string" && j.say ? j.say : `I couldn't reach your apps just now${j.error ? ` (${j.error})` : ""}, so nothing was closed.`);
    }
    return { text: says.join(" "), calls, outputs };
}
