// The real effects behind chat-asks.ts (index.ts wires this; tests use stubs). Opening is pre-approved computer control.
import { execFile } from "node:child_process";
import { resolveApplication } from "./executors.js";
import { scriptPath } from "./tool-guards.js";
const run = (file, args, timeout) => new Promise((resolve) => execFile(file, args, { timeout, maxBuffer: 1 << 20 }, (e, stdout, stderr) => resolve({
    stdout: e ? String(stderr || stdout || e.message) : String(stdout ?? ""), code: e ? (typeof e.code === "number" ? e.code : 1) : 0
})));
export const liveChatDeps = () => ({
    open: (args) => run("/usr/bin/open", args, 15_000),
    installed: (app) => resolveApplication(app).then(() => true, () => false),
    tasks: (args) => run(scriptPath("orion-tasks"), args, 30_000),
});
