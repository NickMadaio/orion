/*
 Mouse turns carried out (w18 mousechat, 2026-11-03): mouse-read.ts says what he meant, scripts/orion-mouse does the work and the writing, and
 every reply is the script's own sentence (its `say`). The one thing kept here is the follow-up ORION is waiting on ("which button, the front or
 the back one?"), in MouseMemory: a reply binds to it only while that question is still the last thing said in this chat, and it expires.
 A yes to a new-mouse outreach starts `orion-mouse setup`; a yes to the defaults it suggests runs `setup --apply`.
*/
import { execFile } from "node:child_process";
import { scriptPath } from "./tool-guards.js";
const RUN_TIMEOUT_MS = 15_000;
const WAIT_MS = 10 * 60_000;
/** The real script with the plugin's state dir. Wired in by index.ts only. */
export const liveMouseRun = (stateDir) => (args) => new Promise((resolve) => execFile(scriptPath("orion-mouse"), args, { timeout: RUN_TIMEOUT_MS, maxBuffer: 1 << 20, env: { ...process.env, ...(stateDir ? { ORION_CONTROLLED_DIR: stateDir } : {}) } }, (e, stdout) => resolve({ stdout: String(stdout ?? ""), code: e ? (typeof e.code === "number" ? e.code : 1) : 0 })));
/** Per chat: what ORION is waiting on, until anything else is said or ten minutes pass. */
export class MouseMemory {
    waiting = new Map();
    wait(key, nowMs, w) { this.waiting.set(key, { at: nowMs, ...w }); }
    clear(key) { this.waiting.delete(key); }
    others = new Map();
    /** A turn that was not about the mouse; a yes after it is no longer the answer to a mouse outreach. */
    otherTurn(key, nowMs) { this.others.set(key, nowMs); }
    lastOther(key) { return this.others.get(key) ?? 0; }
    get(key, nowMs) {
        const w = this.waiting.get(key);
        if (!w || nowMs - w.at > WAIT_MS)
            return undefined;
        return { ...(w.pending ? { pending: w.pending } : {}), ...(w.confirm ? { confirm: true } : {}) };
    }
}
const parse = (stdout) => { try {
    return JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
}
catch {
    return { ok: false, error: "orion-mouse gave no answer" };
} };
const failed = (error) => `I couldn't change the mouse settings just now${error ? ` (${error})` : ""}, so nothing was changed. Tell me again in a bit.`;
const argsFor = (turn) => {
    const app = (a) => (a ? ["--app", a] : []);
    switch (turn.kind) {
        case "status": return ["status", "--json"];
        case "set": return ["set", turn.button, turn.action, ...app(turn.app), "--json"];
        case "clear": return ["clear", turn.button, ...app(turn.app), "--json"];
        case "passthrough": return ["passthrough", turn.op, turn.app, "--json"];
        case "games": return ["games", turn.state, "--json"];
        case "setup": return ["setup", "--json"];
        case "apply": return ["setup", "--apply", "--json"];
        default: return null;
    }
};
/** Carries out one mouse turn. Never throws; a failure is one honest sentence. */
export async function runMouseTurn(turn, deps) {
    if (turn.kind === "many") { // each binding in order; a question or a failure stops the rest and is said after what was done
        const done = [];
        for (const one of turn.turns) {
            const out = await runMouseTurn(one, deps);
            done.push(out);
            if (out.pending || out.text.startsWith("I couldn't") || /^(?:The |This |I don't |There )/.test(out.text))
                break;
        }
        const last = done.at(-1);
        return { text: done.map((d) => d.text).join(" "), calls: done.flatMap((d) => d.calls), outputs: done.flatMap((d) => d.outputs), ...(last.pending ? { pending: last.pending } : {}) };
    }
    if (turn.kind === "decline")
        return { text: 'No problem. Say "set up my mouse" whenever you want to.', calls: [], outputs: [] };
    if (turn.kind === "cancel")
        return { text: "Okay, leaving it as it is.", calls: [], outputs: [] };
    const args = argsFor(turn);
    const r = await deps.run(args).catch((e) => ({ stdout: JSON.stringify({ ok: false, error: String(e) }), code: 1 }));
    const j = parse(r.stdout);
    const calls = [`orion-mouse ${args.join(" ")}`], outputs = [r.stdout.trim().slice(0, 2000)];
    if (!j.ok)
        return { text: typeof j.say === "string" && j.say ? j.say : failed(j.error), calls, outputs };
    const text = String(j.say ?? "");
    if (turn.kind === "set" && (j.ask === "button" || j.ask === "action")) {
        const button = j.button !== undefined ? String(j.button) : turn.button || undefined;
        const action = turn.action || undefined;
        return { text, calls, outputs, pending: { ask: j.ask, ...(button ? { button } : {}), ...(action ? { action } : {}), ...(turn.app ? { app: turn.app } : {}) } };
    }
    if (turn.kind === "clear" && j.ask === "button")
        return { text, calls, outputs, pending: { ask: "button", clear: true, ...(turn.app ? { app: turn.app } : {}) } };
    return { text, calls, outputs, ...(turn.kind === "setup" && j.asking ? { confirm: true } : {}) };
}
