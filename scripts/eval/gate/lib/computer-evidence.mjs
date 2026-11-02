// Evidence for computer-use items (2026-11-02). The computer loop's reply is code-built, so its steps never reach
// the session transcript the gate reads tool calls from, and Notes is outside every tracked file. Two fixes:
//  - the plugin appends each loop's steps to `<shadow log>.steps`; computerSteps() reads those as tool calls;
//  - notes are probed by id before and after the item: what it created is reported, then moved to Recently Deleted
//    (with control on, the sandbox tier acts on the real Mac).
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

export const stepsFile = (p) => `${p.shadow}.steps`;

/** The loop's steps since `sinceMs` as gate tool calls, same shape as the transcript's. */
export function computerSteps(p, sinceMs, sessionKey = null) {
  const file = stepsFile(p);
  if (!existsSync(file)) return [];
  const calls = [];
  for (const line of readFileSync(file, "utf8").split("\n")) {
    let e; try { e = JSON.parse(line); } catch { continue; }
    if (!e || Date.parse(e.at) < sinceMs || (sessionKey && e.sessionKey && !e.sessionKey.endsWith(sessionKey) && !sessionKey.endsWith(e.sessionKey))) continue;
    for (const s of Array.isArray(e.steps) ? e.steps : []) {
      calls.push({ tool: "computer", args: String(s.canonical ?? "").slice(0, 600), result: String(s.stdout ?? "").slice(0, 500), ...(s.exit ? { isError: true } : {}) });
    }
  }
  return calls;
}

const HARD_MS = 20000;
const osa = (script) => new Promise((resolve) => execFile("osascript", ["-e", script], { timeout: HARD_MS, killSignal: "SIGKILL", maxBuffer: 1 << 20 }, (e, stdout) => resolve(e ? null : String(stdout))));
const bounded = (body) => `with timeout of 15 seconds\ntell application "Notes"\n${body}\nend tell\nend timeout`;
const MAX_DELETES = 5;

/**
 * Notes access through osascript, never enumerating the library (a big one wedged Notes.app, 2026-11-02): only notes
 * created after the run's start are asked for, each call under a 15 s AppleScript timeout and a 20 s hard kill.
 * Tests pass their own object with the same two methods.
 */
export const liveNotes = {
  /** [{id, name}] created in the last `secondsAgo`; null when Notes is slow or unreachable. */
  async createdSince(secondsAgo) {
    const n = Math.max(1, Math.ceil(secondsAgo));
    const out = await osa(bounded(`set out to ""\nrepeat with n in (notes whose creation date > ((current date) - ${n}))\nset out to out & (id of n) & tab & (name of n) & linefeed\nend repeat\nreturn out`));
    if (out === null) return null;
    return out.split("\n").filter(Boolean).map((l) => { const [id, ...rest] = l.split("\t"); return { id, name: rest.join("\t") }; });
  },
  async remove(id) { return (await osa(bounded(`delete note id ${JSON.stringify(id)}`))) !== null; },
};

/** The moment the item starts (a number), taken before any turn. */
export async function notesBefore() { return Date.now(); }

/** Notes created since `startMs` (2 s of slack for clock rounding). Slow or unreadable Notes is reported as not probed, never guessed. */
export async function notesEffect(startMs, notes = liveNotes) {
  if (!Number.isFinite(startMs)) return { probed: false, created: [], deleted: [] };
  const created = await notes.createdSince((Date.now() - startMs) / 1000 + 2).catch(() => null);
  return created === null ? { probed: false, created: [], deleted: [] } : { probed: true, created, deleted: [] };
}

/** Moves the notes the item created (at most a handful) to Recently Deleted; `deleted` lists what really went. */
export async function cleanupNotes(effect, notes = liveNotes) {
  const deleted = [];
  for (const n of effect.created.slice(0, MAX_DELETES)) if (await notes.remove(n.id).catch(() => false)) deleted.push(n.id);
  return { ...effect, deleted };
}
