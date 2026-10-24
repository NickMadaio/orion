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
import { mkdirSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const STAGE_LABELS = {
  "understanding": "working out what you need",
  "reading-calendar": "checking your calendar",
  "reading-tomorrow": "looking at tomorrow",
  "checking-todos": "checking your to-dos",
  "checking-deadlines": "checking what's due",
  "checking-notes": "looking through my notes",
  "checking-messages": "reading your messages",
  "checking-focus": "checking your focus session",
  "changing-calendar": "making the change on your calendar",
  "thinking": "putting the answer together",
  "double-checking": "double-checking the answer",
  "using-tool": "running a tool",
} as const;

export type StageId = keyof typeof STAGE_LABELS;

export type ProgressEntry = { readonly stage: StageId; readonly label: string; readonly at: string; readonly detail?: string };

export type ProgressDoc = {
  readonly v: 1;
  readonly sessionKey: string;
  readonly runId: string | null;
  readonly startedAt: string;
  readonly updatedAt: string;
  readonly stages: readonly ProgressEntry[];
  readonly done: boolean;
};

/** Progress files older than this are deleted when a new turn begins (one file per session otherwise lingers forever). */
export const PRUNE_AFTER_MS = 24 * 60 * 60_000;

/** Most stages a single turn keeps; a tool loop cannot grow the file without bound. */
export const MAX_STAGES = 24;

/** The file name for a session key: anything but letters, digits, dot, dash and underscore becomes "_". */
export function progressFileName(sessionKey: string): string {
  const safe = sessionKey.replace(/[^A-Za-z0-9._-]/g, "_").slice(0, 160);
  return `${safe || "unknown"}.json`;
}

export function beginDoc(sessionKey: string, runId: string | null, now: Date): ProgressDoc {
  const at = now.toISOString();
  return { v: 1, sessionKey, runId, startedAt: at, updatedAt: at, stages: [{ stage: "understanding", label: STAGE_LABELS.understanding, at }], done: false };
}

/** A new stage, unless it repeats the last one (same stage and detail): a tool loop of reads is one "checking your calendar". */
export function addStage(doc: ProgressDoc, stage: StageId, now: Date, detail?: string): ProgressDoc {
  if (doc.done) return doc;
  const last = doc.stages[doc.stages.length - 1];
  const cleanDetail = detail?.replace(/\s+/g, " ").trim().slice(0, 60) || undefined;
  if (last && last.stage === stage && last.detail === cleanDetail) return doc;
  if (doc.stages.length >= MAX_STAGES) return doc;
  const at = now.toISOString();
  const entry: ProgressEntry = cleanDetail ? { stage, label: STAGE_LABELS[stage], at, detail: cleanDetail } : { stage, label: STAGE_LABELS[stage], at };
  return { ...doc, updatedAt: at, stages: [...doc.stages, entry] };
}

export function finishDoc(doc: ProgressDoc, now: Date): ProgressDoc {
  return doc.done ? doc : { ...doc, done: true, updatedAt: now.toISOString() };
}

/** What code read for the turn (`Run.reads`) as stages, in order, without repeats. */
export function stagesForReads(reads: readonly string[] | undefined): StageId[] {
  const map: Record<string, StageId> = {
    "day": "reading-calendar", "day-tomorrow": "reading-tomorrow", "deadlines": "checking-deadlines",
    "notes": "checking-notes", "learned": "checking-notes", "messages": "checking-messages", "gmail": "checking-messages",
    "todos": "checking-todos", "focus": "checking-focus",
  };
  const out: StageId[] = [];
  for (const read of reads ?? []) {
    const stage = map[read];
    if (stage && !out.includes(stage)) out.push(stage);
  }
  return out;
}

const CALENDAR_WRITE = /\borion-reschedule\s+(?!show\b)(?:add|move|day|late|undo|shrink|delete|remove|push|edit)\b|\borion-agenda\s+(?:add|move|delete|edit)\b|\bcalendar[-_ ](?:add|move|update|delete|create)\b/i;
const CALENDAR_READ = /\borion-agenda\b|\borion-reschedule\s+show\b|\bcalendar\b|\bagenda\b|\bgog\s+calendar\b/i;
const TODOS = /\btodos?\b|\bto-dos?\b|\breminders?\b|orion-todo/i;
const NOTES = /\bbrain\b|\bmemory\b|\bnotes?\b/i;
const MESSAGES = /\bgmail\b|\bmail\b|\bmessages?\b|\bimessage\b/i;

/** The title a calendar write names (`--title "Gym"`, `--plan "Gym, 90, 17:50"`, `move "Gym"`), for "moving Gym". */
export function writeTarget(command: string): string | undefined {
  const quoted = command.match(/--(?:title|name|event|plan)\s+"([^",]+)/) ?? command.match(/\b(?:move|add|delete|shrink|push)\s+"([^",]+)"/);
  return quoted?.[1]?.trim() || undefined;
}

/** The stage a host tool call stands for. `exec` is read through its command line. */
export function stageForTool(toolName: string, command = ""): { stage: StageId; detail?: string } {
  const text = toolName === "exec" ? command : `${toolName} ${command}`;
  if (CALENDAR_WRITE.test(text)) { const detail = writeTarget(text); return detail ? { stage: "changing-calendar", detail } : { stage: "changing-calendar" }; }
  if (TODOS.test(text)) return { stage: "checking-todos" };
  if (CALENDAR_READ.test(text)) return { stage: "reading-calendar" };
  if (MESSAGES.test(text)) return { stage: "checking-messages" };
  if (NOTES.test(text) || /tool_search|tool_describe/.test(toolName)) return { stage: "checking-notes" };
  return { stage: "using-tool" };
}

/** Holds one doc per session and writes it on every change. Never throws. */
export class TurnProgress {
  private readonly docs = new Map<string, ProgressDoc>();

  constructor(private readonly dir: string, private readonly now: () => Date = () => new Date()) {}

  fileFor(sessionKey: string): string { return join(this.dir, progressFileName(sessionKey)); }

  current(sessionKey: string): ProgressDoc | undefined { return this.docs.get(sessionKey); }

  begin(sessionKey: string, runId: string | null): void {
    if (!sessionKey) return;
    this.prune();
    this.put(beginDoc(sessionKey, runId, this.now()));
  }

  /** Deletes progress files (and stray temp files) not touched for a day. Never throws. */
  prune(): void {
    const cutoff = this.now().getTime() - PRUNE_AFTER_MS;
    try {
      for (const name of readdirSync(this.dir)) {
        if (!name.endsWith(".json") && !name.endsWith(".tmp")) continue;
        const file = join(this.dir, name);
        try { if (statSync(file).mtimeMs < cutoff) unlinkSync(file); } catch { /* raced with a writer: leave it */ }
      }
    } catch { /* no directory yet */ }
  }

  stage(sessionKey: string | undefined, stage: StageId, detail?: string): void {
    const doc = sessionKey ? this.docs.get(sessionKey) : undefined;
    if (!doc) return;
    const next = addStage(doc, stage, this.now(), detail);
    if (next !== doc) this.put(next);
  }

  finish(sessionKey: string | undefined): void {
    const doc = sessionKey ? this.docs.get(sessionKey) : undefined;
    if (!doc) return;
    this.put(finishDoc(doc, this.now()));
    this.docs.delete(doc.sessionKey);
  }

  private put(doc: ProgressDoc): void {
    if (!doc.done) this.docs.set(doc.sessionKey, doc);
    try {
      mkdirSync(this.dir, { recursive: true, mode: 0o700 });
      const file = this.fileFor(doc.sessionKey);
      const temp = `${file}.${process.pid}.tmp`;
      writeFileSync(temp, `${JSON.stringify(doc)}\n`, { mode: 0o600 });
      renameSync(temp, file);
    } catch { /* progress is a courtesy: a failed write never touches the turn */ }
  }
}
