/*
 Shutdown turns carried out (w18 bedtime, 2026-11-04): bedtime-shutdown-read.ts says what he meant, scripts/orion-bedtime-shutdown does it, and the
 reply is the script's own sentence: what it closed, what is waiting on a save, whether the Mac really locked. Nothing is claimed that it did not report.
*/
import { execFile } from "node:child_process";
import { scriptPath } from "./tool-guards.js";
/** The apps wait up to ~8 s each, in parallel, then the lock: this is the hard stop behind that. */
const RUN_TIMEOUT_MS = 90_000;
export const liveShutdownRun = () => (args) => new Promise((resolve) => execFile(scriptPath("orion-bedtime-shutdown"), args, { timeout: RUN_TIMEOUT_MS, maxBuffer: 1 << 20 }, (e, stdout) => resolve({ stdout: String(stdout ?? ""), code: e ? (typeof e.code === "number" ? e.code : 1) : 0 })));
export function argsFor(turn) {
    switch (turn.kind) {
        case "run": return ["run", "--json"];
        case "pass": return ["pass", String(turn.minutes), "--json"];
        case "override": return ["override", turn.on ? "on" : "off", "--json"];
    }
}
const NOTHING = "I couldn't shut the Mac down just now, so nothing was closed or locked. Say go and I'll retry it.";
export async function runShutdownTurn(turn, deps) {
    const args = argsFor(turn);
    const r = await deps.run(args).catch(() => ({ stdout: "", code: 1 }));
    let say;
    try {
        const j = JSON.parse(r.stdout.trim().split("\n").at(-1) ?? "");
        if (typeof j.say === "string" && j.say)
            say = j.say;
    }
    catch { /* no answer */ }
    return { text: say ?? (turn.kind === "run" ? NOTHING : "I couldn't change that just now. Say go and I'll retry it."), calls: [`orion-bedtime-shutdown ${args.join(" ")}`], outputs: [r.stdout.trim().slice(0, 2000)] };
}
