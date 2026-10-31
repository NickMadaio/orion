/*
 When the local model is down (2026-10-30).

 Ollama quit at 23:03 on 10-28 and nothing restarted it. On 10-30 at 10:32 and 13:32 Nick said "I don't have classes
 today" and each turn ended in "Connection error." with no reply: the messages were simply lost. Now, before the model
 is called (OpenClaw's before_agent_run gate, after the prompt is built):
   1. Ollama is asked if it is up (/api/version, ~ms when it is).
   2. Down: warm it (load the models) and ask once more after a short wait.
   3. Still down: the turn is stopped with an honest line written by code, and his message is queued in
      pending-replay.jsonl. A turn whose effect code already carried out (a reality statement, a code flow) is told as
      done instead, and is not queued: its work does not need the model.
   4. When Ollama answers again (checked every minute while anything is queued, and on every turn), each queued message
      is replayed in its own session and the reply is pushed to him (index.ts wires orion-reach), marked as a replay.
 Note: OpenClaw prefixes a gate's message with "Your message could not be sent:", so the line is written to read true
 after it.
*/
import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
export const OUTAGE_LINE = "My local model is down — I've saved your message and will act on it when it's back.";
export const doneWhileDown = (said) => `${said} (My local model is down, so that's all I can say for now.)`;
export const QUEUE_FILE = "pending-replay.jsonl";
export const UP_CACHE_MS = 15_000;
export const REPLAY_MARK = /^\(Replayed — you sent this at [^)]*while my local model was down\)\s*/;
export const replayText = (row, at) => `(Replayed — you sent this at ${at} while my local model was down) ${row.message}`;
/** Ollama answers /api/version within `timeoutMs`. Never throws. */
export async function probeOllama({ fetchImpl = fetch, baseUrl = "http://127.0.0.1:11434", timeoutMs = 1500 } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const res = await fetchImpl(`${baseUrl}/api/version`, { signal: controller.signal });
        return res.ok;
    }
    catch {
        return false;
    }
    finally {
        clearTimeout(timer);
    }
}
/** Up or down, with one warm-and-retry when down. "Up" is remembered for UP_CACHE_MS so a healthy turn costs nothing. */
export class ModelHealth {
    probe;
    warm;
    waitMs;
    clock;
    upAt = 0;
    constructor(probe, warm, waitMs = 1500, clock = () => Date.now()) {
        this.probe = probe;
        this.warm = warm;
        this.waitMs = waitMs;
        this.clock = clock;
    }
    async check() {
        if (this.clock() - this.upAt < UP_CACHE_MS)
            return true;
        if (await this.probe().catch(() => false))
            return this.mark();
        await this.warm().catch(() => undefined);
        await new Promise((r) => setTimeout(r, this.waitMs));
        return (await this.probe().catch(() => false)) ? this.mark() : false;
    }
    mark() { this.upAt = this.clock(); return true; }
}
/** The messages that arrived while the model was down, one JSON row each (rewritten as they are replayed). */
export class ReplayQueue {
    dir;
    constructor(dir) {
        this.dir = dir;
    }
    get path() { return join(this.dir, QUEUE_FILE); }
    all() {
        try {
            return readFileSync(this.path, "utf8").split("\n").flatMap((l) => { try {
                return l.trim() ? [JSON.parse(l)] : [];
            }
            catch {
                return [];
            } });
        }
        catch {
            return [];
        }
    }
    pending() { return this.all().filter((r) => r.state === "queued"); }
    add(row, now = new Date()) {
        // The same words in the same session while still queued are kept once (the host re-resolves a failed turn several times).
        const existing = this.pending().find((r) => r.sessionKey === row.sessionKey && r.message === row.message);
        if (existing)
            return existing;
        const stored = { id: `q-${randomUUID().slice(0, 8)}`, at: now.toISOString(), ...row, message: row.message.slice(0, 2000), state: "queued", tries: 0 };
        mkdirSync(this.dir, { recursive: true });
        appendFileSync(this.path, `${JSON.stringify(stored)}\n`, { mode: 0o600 });
        return stored;
    }
    set(id, change) {
        const rows = this.all().map((r) => (r.id === id ? { ...r, ...change } : r));
        const tmp = `${this.path}.${process.pid}.tmp`;
        writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""), { mode: 0o600 });
        renameSync(tmp, this.path);
    }
}
/** Replays what is queued once the model answers. A replay that fails three times is marked failed and left for a person. */
export async function drainQueue(queue, health, replay) {
    const rows = queue.pending();
    if (!rows.length || !(await health.check()))
        return 0;
    let done = 0;
    for (const row of rows) {
        const ok = await replay(row).catch(() => false);
        if (ok) {
            queue.set(row.id, { state: "replayed", tries: row.tries + 1 });
            done += 1;
        }
        else
            queue.set(row.id, { tries: row.tries + 1, ...(row.tries + 1 >= 3 ? { state: "failed" } : {}) });
    }
    return done;
}
