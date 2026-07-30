import { readdir, open, stat } from "node:fs/promises";
import { join } from "node:path";
import { homedir } from "node:os";
/**
 * The third provenance source: the host-written session transcript.
 *
 * Why this exists
 * ---------------
 * Trust must come from the user's own words, and the two hooks that carry them
 * do not fire for locally-initiated runs. Measured on the live system:
 *
 *     channelMessageHookFired: false   // `message_received` is a CHANNEL event
 *     promptHookFired:         false   // `llm_input` does not fire here either
 *     toolCallHookFired:       true
 *     retainedTurns:           0
 *
 * With no user text reaching the gate, a fail-closed check rejects everything —
 * which is exactly what happened.
 *
 * OpenClaw writes every turn to `~/.openclaw/agents/<agent>/sessions/<id>.jsonl`
 * as newline-delimited JSON:
 *
 *     {"type":"message","id":"…","timestamp":"…",
 *      "message":{"role":"user","content":[{"type":"text","text":"…"}]}}
 *
 * The security property that makes this a legitimate source: **the model cannot
 * author a `role: "user"` entry.** It emits assistant messages and tool calls;
 * the host writes the user turns. So a `user` entry is evidence of a real
 * instruction in exactly the way a model-supplied `trusted_user` tag never was.
 *
 * What this deliberately does NOT do: parse, summarise, or interpret. It
 * returns the raw text, and the existing validator still requires that text to
 * name the operation and the exact target. This widens where the user's words
 * come from, not what counts as authorization.
 *
 * Costs, since they were asked about: nothing reaches the model, so zero
 * tokens. Only the tail of the file is read (`TAIL_BYTES`), so memory is
 * bounded regardless of how long a conversation runs. One local read, ~1ms,
 * against a turn that already costs well over a second.
 */
/** Never read more than this from the end of a transcript. */
const TAIL_BYTES = 256 * 1024;
/** Ignore transcripts older than this; a stale file is not this turn. */
const MAX_TRANSCRIPT_AGE_MS = 10 * 60 * 1000;
/** Hard ceiling on returned text, matching the provenance store's own limit. */
const MAX_TEXT = 8192;
function agentsRootDefault() {
    return join(homedir(), ".openclaw", "agents");
}
/**
 * Pull the text out of one transcript line, but only if the host attributed it
 * to the user. Anything else — assistant, system, tool — is not evidence of an
 * instruction and is ignored.
 */
export function userTextFromLine(line) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("{"))
        return undefined;
    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    }
    catch {
        return undefined;
    }
    if (!parsed || typeof parsed !== "object")
        return undefined;
    const record = parsed;
    const message = (record.message ?? record);
    if (!message || typeof message !== "object")
        return undefined;
    if (message.role !== "user")
        return undefined;
    const content = message.content;
    if (typeof content === "string")
        return content.trim() || undefined;
    if (Array.isArray(content)) {
        const parts = [];
        for (const part of content) {
            if (typeof part === "string") {
                parts.push(part);
                continue;
            }
            if (part && typeof part === "object") {
                const block = part;
                // Only plain text. A tool_result block is model-influenced data, not
                // the user speaking, and must never be read as an instruction.
                if (block.type === "text" && typeof block.text === "string") {
                    parts.push(block.text);
                }
            }
        }
        const joined = parts.join("\n").trim();
        return joined || undefined;
    }
    return undefined;
}
function timestampOf(line, fallback) {
    try {
        const record = JSON.parse(line);
        const raw = record.timestamp;
        if (typeof raw === "string") {
            const parsed = Date.parse(raw);
            if (Number.isFinite(parsed))
                return parsed;
        }
    }
    catch {
        /* fall through */
    }
    return fallback;
}
/** Read at most the last `TAIL_BYTES` of a file, as UTF-8. */
async function readTail(path) {
    const handle = await open(path, "r");
    try {
        const { size } = await handle.stat();
        const start = Math.max(0, size - TAIL_BYTES);
        const length = size - start;
        if (length <= 0)
            return "";
        const buffer = Buffer.alloc(Number(length));
        await handle.read(buffer, 0, buffer.length, start);
        return buffer.toString("utf8");
    }
    finally {
        await handle.close();
    }
}
/**
 * The newest session transcript for an agent, ignoring `.trajectory.jsonl`
 * (a parallel log that is not the conversation) and anything stale.
 */
async function newestSessionFile(dir, now) {
    let names;
    try {
        names = await readdir(dir);
    }
    catch {
        return undefined;
    }
    let best;
    for (const name of names) {
        if (!name.endsWith(".jsonl"))
            continue;
        if (name.endsWith(".trajectory.jsonl"))
            continue;
        const path = join(dir, name);
        let mtime;
        try {
            mtime = (await stat(path)).mtimeMs;
        }
        catch {
            continue;
        }
        if (now - mtime > MAX_TRANSCRIPT_AGE_MS)
            continue;
        if (!best || mtime > best.mtime) {
            best = { path, sessionId: name.slice(0, -".jsonl".length), mtime };
        }
    }
    return best ? { path: best.path, sessionId: best.sessionId } : undefined;
}
/**
 * The most recent user-authored turn in the bound session.
 *
 * Returns undefined rather than throwing: a missing or unreadable transcript
 * must fail closed like every other absent provenance source, not error out of
 * a tool call.
 */
export async function readLatestUserTurn(options = {}) {
    const now = (options.now ?? Date.now)();
    const root = options.agentsRoot ?? agentsRootDefault();
    const agent = options.agent ?? "main";
    const dir = join(root, agent, "sessions");
    let target;
    if (options.sessionId) {
        // A session id from the host is exact; prefer it over any heuristic.
        target = {
            path: join(dir, `${options.sessionId}.jsonl`),
            sessionId: options.sessionId,
        };
        try {
            await stat(target.path);
        }
        catch {
            target = undefined;
        }
    }
    target ??= await newestSessionFile(dir, now);
    if (!target)
        return undefined;
    let tail;
    try {
        tail = await readTail(target.path);
    }
    catch {
        return undefined;
    }
    const lines = tail.split("\n");
    // The first line may be a fragment if the tail cut mid-record; JSON.parse
    // rejects it, so no special case is needed.
    for (let i = lines.length - 1; i >= 0; i--) {
        const text = userTextFromLine(lines[i]);
        if (!text)
            continue;
        return {
            content: text.slice(0, MAX_TEXT),
            at: timestampOf(lines[i], now),
            sessionId: target.sessionId,
        };
    }
    return undefined;
}
