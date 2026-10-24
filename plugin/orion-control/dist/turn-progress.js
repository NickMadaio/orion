/**
 * Per-turn progress for the Mac app's spoken updates (2026-10-23, Nick: "give small updates on his thinking").
 *
 * OpenClaw's plugin API has no interim-message call, so the plugin writes one small JSON file per session,
 * `<orion-controlled>/turn-progress/<sessionKey, sanitised>.json`, and the app reads it during a voice turn.
 * Only stages that really happened are written (a hook ran, a tool was called, a read was made): the app may
 * speak them, so an invented one would be a lie said out loud.
 *
 * Writes are atomic (temp file + rename), mode 0600, and never throw into a hook: progress is a courtesy,
 * never a reason for a turn to fail.
 */
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
export const STAGE_LABELS = {
    "understanding": "working out what you need",
    "reading-calendar": "checking your calendar",
    "reading-tomorrow": "looking at tomorrow",
    "checking-todos": "checking your to-dos",
    "checking-deadlines": "checking what's due",
    "checking-notes": "looking through my notes",
    "checking-messages": "reading your messages",
    "changing-calendar": "making the change on your calendar",
    "thinking": "putting the answer together",
    "double-checking": "double-checking the answer",
    "using-tool": "running a tool",
};
/** Most stages a single turn keeps; a tool loop cannot grow the file without bound. */
export const MAX_STAGES = 24;
/** The file name for a session key: anything but letters, digits, dot, dash and underscore becomes "_". */
export function progressFileName(sessionKey) {
    const safe = sessionKey.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 160);
    return `${safe || "unknown"}.json`;
}
export function beginDoc(sessionKey, runId, now) {
    const at = now.toISOString();
    return { v: 1, sessionKey, runId, startedAt: at, updatedAt: at, stages: [{ stage: "understanding", label: STAGE_LABELS.understanding, at }], done: false };
}
/** A new stage, unless it repeats the last one (same stage and detail): a tool loop of reads is one "checking your calendar". */
export function addStage(doc, stage, now, detail) {
    if (doc.done)
        return doc;
    const last = doc.stages[doc.stages.length - 1];
    const cleanDetail = detail?.replace(/\s+/g, " ").trim().slice(0, 60) || undefined;
    if (last && last.stage === stage && last.detail === cleanDetail)
        return doc;
    if (doc.stages.length >= MAX_STAGES)
        return doc;
    const at = now.toISOString();
    const entry = cleanDetail ? { stage, label: STAGE_LABELS[stage], at, detail: cleanDetail } : { stage, label: STAGE_LABELS[stage], at };
    return { ...doc, updatedAt: at, stages: [...doc.stages, entry] };
}
export function finishDoc(doc, now) {
    return doc.done ? doc : { ...doc, done: true, updatedAt: now.toISOString() };
}
/** What code read for the turn (`Run.reads`) as stages, in order, without repeats. */
export function stagesForReads(reads) {
    const map = {
        "day": "reading-calendar", "day-tomorrow": "reading-tomorrow", "deadlines": "checking-deadlines",
        "notes": "checking-notes", "learned": "checking-notes", "messages": "checking-messages", "gmail": "checking-messages",
        "todos": "checking-todos", "focus": "reading-calendar",
    };
    const out = [];
    for (const read of reads ?? []) {
        const stage = map[read];
        if (stage && !out.includes(stage))
            out.push(stage);
    }
    return out;
}
const CALENDAR_WRITE = /\borion-reschedule\s+(?!show\b)(?:add|move|day|late|undo|shrink|delete|remove|push|edit)\b|\borion-agenda\s+(?:add|move|delete|edit)\b|\bcalendar[-_ ](?:add|move|update|delete|create)\b/i;
const CALENDAR_READ = /\borion-agenda\b|\borion-reschedule\s+show\b|\bcalendar\b|\bagenda\b|\bgog\s+calendar\b/i;
const TODOS = /\btodos?\b|\bto-dos?\b|\breminders?\b|orion-todo/i;
const NOTES = /\bbrain\b|\bmemory\b|\bnotes?\b/i;
const MESSAGES = /\bgmail\b|\bmail\b|\bmessages?\b|\bimessage\b/i;
/** The title a calendar write names (`--title "Gym"`, `--plan "Gym, 90, 17:50"`, `move "Gym"`), for "moving Gym". */
export function writeTarget(command) {
    const quoted = command.match(/--(?:title|name|event|plan)\s+"([^",]+)/) ?? command.match(/\b(?:move|add|delete|shrink|push)\s+"([^",]+)"/);
    return quoted?.[1]?.trim() || undefined;
}
/** The stage a host tool call stands for. `exec` is read through its command line. */
export function stageForTool(toolName, command = "") {
    const text = toolName === "exec" ? command : `${toolName} ${command}`;
    if (CALENDAR_WRITE.test(text)) {
        const detail = writeTarget(text);
        return detail ? { stage: "changing-calendar", detail } : { stage: "changing-calendar" };
    }
    if (TODOS.test(text))
        return { stage: "checking-todos" };
    if (CALENDAR_READ.test(text))
        return { stage: "reading-calendar" };
    if (MESSAGES.test(text))
        return { stage: "checking-messages" };
    if (NOTES.test(text) || /tool_search|tool_describe/.test(toolName))
        return { stage: "checking-notes" };
    return { stage: "using-tool" };
}
/** Holds one doc per session and writes it on every change. Never throws. */
export class TurnProgress {
    dir;
    now;
    docs = new Map();
    constructor(dir, now = () => new Date()) {
        this.dir = dir;
        this.now = now;
    }
    fileFor(sessionKey) { return join(this.dir, progressFileName(sessionKey)); }
    current(sessionKey) { return this.docs.get(sessionKey); }
    begin(sessionKey, runId) {
        if (!sessionKey)
            return;
        this.put(beginDoc(sessionKey, runId, this.now()));
    }
    stage(sessionKey, stage, detail) {
        const doc = sessionKey ? this.docs.get(sessionKey) : undefined;
        if (!doc)
            return;
        const next = addStage(doc, stage, this.now(), detail);
        if (next !== doc)
            this.put(next);
    }
    finish(sessionKey) {
        const doc = sessionKey ? this.docs.get(sessionKey) : undefined;
        if (!doc)
            return;
        this.put(finishDoc(doc, this.now()));
        this.docs.delete(doc.sessionKey);
    }
    put(doc) {
        if (!doc.done)
            this.docs.set(doc.sessionKey, doc);
        try {
            mkdirSync(this.dir, { recursive: true, mode: 0o700 });
            const file = this.fileFor(doc.sessionKey);
            const temp = `${file}.${process.pid}.tmp`;
            writeFileSync(temp, `${JSON.stringify(doc)}\n`, { mode: 0o600 });
            renameSync(temp, file);
        }
        catch { /* progress is a courtesy: a failed write never touches the turn */ }
    }
}
