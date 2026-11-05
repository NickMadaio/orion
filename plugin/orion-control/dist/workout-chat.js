/*
 Workout turns carried out (w17 g-workout, 2026-11-03): workout-read.ts says what he meant, scripts/orion-workout-log does the work and the
 writing, and every reply is the script's own sentence (its `say`). The follow-up waiting on an answer is the script's workout-pending.json
 (scripts/lib/workout/pending.mjs has the contract).

 Binding: a reply ("55 min and 185 on squats", "skip") is the follow-up's only while the question is still the last thing in this chat.
 WorkoutMemory records every other turn; a turn about anything else after the question unbinds it, and a label naming a different
 message unbinds it too. Same rule as FoodMemory, so a question about the weather can never be taken as "how long was it".
*/
import { execFile } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { scriptPath } from "./tool-guards.js";
/** Reading a description is one local-model call (a few seconds); the script's own limit is 40 s, this is the hard stop behind it. */
const RUN_TIMEOUT_MS = 50_000;
/** The real script with the plugin's state dir. Wired in by index.ts only. */
export const liveWorkoutRun = (stateDir) => (args) => new Promise((resolve) => execFile(scriptPath("orion-workout-log"), args, { timeout: RUN_TIMEOUT_MS, maxBuffer: 1 << 20, env: { ...process.env, ...(stateDir ? { ORION_CONTROLLED_DIR: stateDir } : {}) } }, (e, stdout) => resolve({ stdout: String(stdout ?? ""), code: e ? (typeof e.code === "number" ? e.code : 1) : 0 })));
/** The live follow-up in workout-pending.json, or undefined. */
export function readWorkoutPending(stateDir, now) {
    try {
        const row = JSON.parse(readFileSync(join(stateDir, "workout-pending.json"), "utf8"));
        if (!row.draft || !(Date.parse(String(row.expiresAt)) > now.getTime()) || !Number.isFinite(Date.parse(String(row.at))) || typeof row.question !== "string")
            return undefined;
        return { at: Date.parse(String(row.at)), asked: Number(row.asked ?? 1), question: row.question };
    }
    catch {
        return undefined;
    }
}
/** Per chat: when a non-workout turn last happened, and the last workout logged here (for "undo"). */
export class WorkoutMemory {
    others = new Map();
    logs = new Map();
    otherTurn(key, nowMs) { this.others.set(key, nowMs); }
    logged(key, id, nowMs) { this.logs.set(key, { id, at: nowMs }); }
    lastLogged(key) { return this.logs.get(key); }
    forgetLog(key) { this.logs.delete(key); }
    /** The question is still what this chat is answering: nothing else was said since, and any label is the question's own line. */
    bound(key, pending, label) {
        if (label && !label.includes(pending.question.slice(0, 24)))
            return false;
        return (this.others.get(key) ?? 0) <= pending.at;
    }
}
const parse = (stdout) => { try {
    return JSON.parse(stdout.trim().split("\n").at(-1) ?? "");
}
catch {
    return { ok: false, error: "orion-workout-log gave no answer" };
} };
const failed = (error) => `I couldn't log that workout just now${error ? ` (${error})` : ""}, so nothing was logged. Say go and I'll retry it.`;
const argsFor = (turn) => {
    switch (turn.kind) {
        case "describe": return ["--text", turn.text, "--chat", "--json"];
        case "answer": return ["answer", turn.text, "--json"];
        case "skip": return ["answer", "--skip", "--json"];
        case "cancel": return ["discard", "--json"];
        case "undo": return ["undo", turn.id, "--json"];
    }
};
/** Carries out one workout turn. Never throws; a failure is one honest sentence. */
export async function runWorkoutTurn(turn, deps) {
    const args = argsFor(turn);
    const r = await deps.run(args).catch((e) => ({ stdout: JSON.stringify({ ok: false, error: String(e) }), code: 1 }));
    const j = parse(r.stdout);
    const calls = [`orion-workout-log ${args.join(" ")}`], outputs = [r.stdout.trim().slice(0, 2000)];
    if (!j.ok) {
        const text = turn.kind === "undo" ? `I couldn't take it off: ${j.error ?? "the health log didn't answer"}.` : typeof j.say === "string" && j.say ? j.say : failed(j.error);
        return { text, calls, outputs };
    }
    const logged = j.logged?.id;
    return { text: String(j.say ?? ""), calls, outputs, ...(logged ? { logged: { id: logged } } : {}), ...(j.asking ? { asked: true } : {}) };
}
