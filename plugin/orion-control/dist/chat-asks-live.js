// The real effects behind chat-asks.ts (index.ts wires this; tests use stubs). Opening is pre-approved computer control.
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { pageCandidates } from "./named-page.js";
import { resolveApplication } from "./executors.js";
import { scriptPath } from "./tool-guards.js";
const run = (file, args, timeout) => new Promise((resolve) => execFile(file, args, { timeout, maxBuffer: 1 << 20 }, (e, stdout, stderr) => resolve({
    stdout: e ? String(stderr || stdout || e.message) : String(stdout ?? ""), code: e ? (typeof e.code === "number" ? e.code : 1) : 0
})));
const HISTORY = () => join(process.env.ORION_CONTROLLED_DIR || join(homedir(), ".openclaw", "orion-controlled"), "activity-history.jsonl");
/** Domains his Mac showed him on (7 days of activity-history.jsonl) and what his brain holds next to the name. Read-only. */
async function resolveNamed(name) {
    let domains = [];
    try {
        domains = readFileSync(HISTORY(), "utf8").split("\n").flatMap((l) => { try {
            const d = JSON.parse(l).domain;
            return d ? [d] : [];
        }
        catch {
            return [];
        } });
    }
    catch { /* none */ }
    const brain = await run(scriptPath("orion-brain"), ["search", name.slice(0, 120)], 8_000);
    return pageCandidates(name, { domains, snippets: brain.code === 0 ? brain.stdout : "" });
}
export const liveChatDeps = () => ({
    resolveNamed,
    open: (args) => run("/usr/bin/open", args, 15_000),
    installed: (app) => resolveApplication(app).then(() => true, () => false),
    tasks: (args) => run(scriptPath("orion-tasks"), args, 30_000),
});
