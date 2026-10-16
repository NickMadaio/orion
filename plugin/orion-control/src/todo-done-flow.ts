/*
 Ticking a to-do off, decided by code (q042, live sweep 2026-10-16 r8).

 "todo: buy more oats", then "ok mark the oats one done": the front desk picked supplements {do: take,
 name: oats}, toolDirective turned that into supplement_take "oats" (a health-log write) and the reply
 was "Done." while the to-do stayed open. Completing a to-do is code's call: a message that marks
 something done / finished, or ticks / checks / crosses it off, runs `orion-tasks done "<his words>"`
 (exact title, else the to-dos that contain all his words; two or more is a question, never a guess)
 and the reply is built from its output. This runs before toolDirective, so a front-desk
 supplements/other choice cannot hijack it.

 Not this: a supplement ("took my creatine", "mark creatine as taken": taken is not done), a reminder,
 or the calendar ("I'm done with the gym block"). Edge, kept simple: "mark creatine done" with no such
 to-do is "I couldn't find a to-do matching creatine - nothing was changed" (it never logs a supplement).
 Only the imperatives (mark|tick|check|cross + an object) run; statement forms ("done with X",
 "i finished X") fall through (r8 review H3: they ticked the wrong to-do), as do pronoun-only and
 multi-item asks ("check them off").
*/
import { execFile } from "node:child_process";
import type { FlowResult } from "./schedule-flow.js";

export type TodoExec = (args: string[]) => Promise<{ stdout: string; code: number }>;
export const ORION_TASKS = "/Users/nickmadaio/Desktop/ORION/scripts/orion-tasks";

// H3 (2026-10-16 r8 review): only a real imperative writes. Statements ("i finished the milk", "done with
// the oats", "I'm done with work") never exec: "milk" ticked "Buy milk" and "work" ticked a CS2500 to-do.
const VERBS = String.raw`(?:mark|tick|check|cross)`;
const MARK = new RegExp(String.raw`\b${VERBS}\s+(.+?)\s+(?:as\s+)?(?:done|complete|completed|finished|ticked(?:\s+off)?|checked(?:\s+off)?)\b`, "i");
const TICK_OFF = new RegExp(String.raw`\b${VERBS}\s+off\s+(.+)$`, "i");
const TICK_OBJ_OFF = new RegExp(String.raw`\b${VERBS}\s+(.+?)\s+off\b`, "i");
// Not a to-do: the calendar, a reminder, a health log, a question about a state ("check if the lights are off").
const NOT_TODO = /\b(block|session|class|lecture|meeting|appointment|gym|workout|nap|focus|shift|reminders?|alarms?|timer|taken|took|take|supplements?|vitamins?|if|whether|is|are|lights?|phone|dnd|disturb)\b/i;
// "check them off" names nothing, and two items ("the zebra thing and the garage tiling") is the worker's job.
const PRONOUN_ONLY = /^(?:them|it|that|this|those|these|all|everything|both)$/;
const MULTI = /\s(?:and|&)\s|,/i;
const FILLER = new Set(["the", "one", "ones", "todo", "todos", "to-do", "to-dos", "task", "tasks", "my", "a", "an", "that", "this", "it", "please", "pls", "as", "off", "out", "on", "list", "thing", "item", "of", "ok", "okay", "now", "just", "can", "you", "for", "me"]);

/** The to-do words he named, or null when this is not an imperative "mark it done" message. */
export function parseTodoDone(message: string): { words: string; imperative: boolean } | null {
  const text = message.trim();
  if (!text || /\?\s*$/.test(text) || NOT_TODO.test(text)) return null;
  const mark = MARK.exec(text);
  const tick = TICK_OFF.exec(text) ?? TICK_OBJ_OFF.exec(text);
  const raw = mark?.[1] ?? tick?.[1];
  if (raw === undefined || MULTI.test(raw)) return null;
  const words = raw.toLowerCase().replace(/[^a-z0-9' -]/g, " ").split(/\s+/).filter((w) => w && !FILLER.has(w)).join(" ");
  return words && !PRONOUN_ONLY.test(words) ? { words, imperative: true } : null;
}

const say = (text: string, kind: "ask" | "plain", calls?: string[], outputs?: string[]): FlowResult =>
  ({ outcome: "say", kind, text, ...(calls ? { calls, outputs } : {}) });

/** One "mark it done" request, end to end; the reply is built only from orion-tasks' output. */
export async function runTodoDone({ message, exec }: { message: string; exec: TodoExec }): Promise<FlowResult> {
  const req = parseTodoDone(message);
  if (!req) return { outcome: "fallback", reason: "not a to-do completion" };
  const result = await exec(["done", req.words]);
  const out = result.stdout.trim();
  const calls = [`exec orion-tasks done ${JSON.stringify(req.words)}`];
  const ticked = /Changed "(.+?)": done/.exec(out);
  if (result.code === 0 && ticked?.[1]) return { outcome: "done", calls, outputs: [out], reply: `Ticked off "${ticked[1]}".` };
  const many = /more than one to-do matches[^:]*:\s*(.+?)(?:\s+—\s+ask him which)?\s*$/m.exec(out);
  if (many?.[1]) {
    const titles = [...many[1].matchAll(/"([^"]+)"/g)].map((m) => `"${m[1]}"`);
    return say(`Which one: ${titles.join(" or ")}? Nothing was changed yet.`, "ask", calls, [out]);
  }
  if (/no to-do called/.test(out)) {
    return say(`I couldn't find a to-do matching "${req.words}" — nothing was changed.`, "plain", calls, [out]);
  }
  return say(`I couldn't tick off "${req.words}" — nothing was changed.`, "plain", calls, [out]);
}

const runFile = (file: string, args: string[], timeout: number): Promise<{ stdout: string; code: number }> =>
  new Promise((resolve) => execFile(file, args, { timeout, maxBuffer: 1 << 20 }, (error, stdout, stderr) => resolve({
    stdout: error ? String(stderr || stdout || error.message) : String(stdout),
    code: error ? (typeof error.code === "number" ? error.code : 1) : 0,
  })));

/** The real flow: scripts/orion-tasks done. Wired in by index.ts only. */
export const liveTodoDoneFlow = (message: string): Promise<FlowResult> =>
  runTodoDone({ message, exec: (args) => runFile(ORION_TASKS, args, 30000) });
