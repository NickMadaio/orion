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

const osa = (script) => new Promise((resolve) => execFile("osascript", ["-e", script], { timeout: 20000, maxBuffer: 1 << 24 }, (e, stdout) => resolve(e ? null : String(stdout).trim())));

/** Real Notes access through osascript; tests pass their own with the same three methods. */
export const liveNotes = {
  async ids() { const out = await osa('tell application "Notes" to get id of every note'); return out === null ? null : out.split(/,\s*/).filter(Boolean); },
  async name(id) { return osa(`tell application "Notes" to get name of note id ${JSON.stringify(id)}`); },
  async remove(id) { return (await osa(`tell application "Notes" to delete note id ${JSON.stringify(id)}`)) !== null; },
};

export async function notesBefore(notes = liveNotes) { const ids = await notes.ids().catch(() => null); return ids === null ? null : new Set(ids); }

/** Notes created since `before`. A null `before` means Notes could not be read: reported as not probed, never guessed. */
export async function notesEffect(before, notes = liveNotes) {
  if (!before) return { probed: false, created: [], deleted: [] };
  const after = await notes.ids().catch(() => null);
  if (after === null) return { probed: false, created: [], deleted: [] };
  const created = [];
  for (const id of after.filter((x) => !before.has(x))) created.push({ id, name: (await notes.name(id).catch(() => null)) ?? "" });
  return { probed: true, created, deleted: [] };
}

/** Moves every note the item created to Recently Deleted; `deleted` lists what really went. */
export async function cleanupNotes(effect, notes = liveNotes) {
  const deleted = [];
  for (const n of effect.created) if (await notes.remove(n.id).catch(() => false)) deleted.push(n.id);
  return { ...effect, deleted };
}
