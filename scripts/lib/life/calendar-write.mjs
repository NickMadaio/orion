// Calendar writes for the planner, through the Mac bridge, with an undo record.
import { bridgeRequest, sandbox } from "./bridge-path.mjs";
import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";

// An evaluation's undo history is its own, so "undo" during one never reaches his real calendar.
import { readPins, savePins } from "./pins.mjs";

export const UNDO_FILE = process.env.ORION_RESCHEDULE_UNDO
  || join(homedir(), `.openclaw/orion-controlled/${sandbox() ? "eval-" : ""}reschedule-undo.json`);

export async function bridge(action, payload) {
  return bridgeRequest(action, payload);
}

/** Local date + minute of day → ISO. Minutes past 1440 roll into the next day. */
export function iso(date, minute) {
  const [y, m, d] = date.split("-").map(Number);
  return new Date(y, m - 1, d, 0, minute, 0, 0).toISOString().replace(/\.\d{3}Z$/, "Z");
}

export const clean = (title) => String(title).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, 80);

/*
 One change, one undo step (2026-09-29). "Two study sessions" was booked as two
 separate journal entries, so "undo" removed one and ORION said both were gone;
 and a change that did nothing still wrote an empty entry for undo to land on.
 Now `group` merges calls from one command into one entry, and empty changes
 are never recorded.
*/
async function reverseSteps(steps) {
  const done = []; const restored = new Map();
  for (const step of [...steps].reverse()) {
    if (step.op === "move") {
      await bridge("move_calendar_event", { identifier: step.identifier, start: step.start, end: step.end });
      done.push(`put ${step.title} back`);
    }
    if (step.op === "create") {
      await bridge("delete_calendar_event", { identifier: step.identifier }).catch(() => null);
      done.push(`removed ${step.title}`);
    }
    if (step.op === "unskip") {
      const { removeSkip } = await import("./skips.mjs");
      removeSkip(step.title, step.start);
      done.push(`put ${step.title} back`);
    }
    if (step.op === "delete") {
      const payload = { title: step.title, start: step.start, end: step.end };
      if (step.orionKind) payload.orionKind = step.orionKind;
      const result = await bridge("create_calendar_event", payload);
      restored.set(step.identifier, result.identifier);
      done.push(`restored ${step.title}`);
    }
  }
  return { done, restored };
}

export async function applyPlan({ date, moves, created, removed = [], blocksById, group = null, pinIds = [], pinCreated = [] }) {
  const undo = []; const priorPins = readPins(); const addedPins = [];
  try {
    for (const block of removed) {
      if (!block?.calendarId) continue;
      await bridge("delete_calendar_event", { identifier: block.calendarId });
      undo.push({ op: "delete", identifier: block.calendarId, title: block.title, start: iso(date, block.start), end: iso(date, block.end),
        ...(block.source === "orion" ? { orionKind: block.kind } : {}) });
    }
    for (const m of moves) {
      const block = blocksById.get(m.id);
      if (!block?.calendarId) continue;
      // A move may also change the length (extend, resize, shrink to fit): `toEnd`.
      const end = Number.isInteger(m.toEnd) ? m.toEnd : m.to + (block.end - block.start);
      await bridge("move_calendar_event", { identifier: block.calendarId, start: iso(date, m.to), end: iso(date, end) });
      undo.push({ op: "move", identifier: block.calendarId, start: iso(date, block.start), end: iso(date, block.end), title: block.title });
    }
    for (const c of created) {
      const payload = { title: clean(c.title), start: iso(date, c.start), end: iso(date, c.end) };
      if (!c.fixed) payload.orionKind = c.kind;   // Nick's own plans stay unmarked, so they never move
      const result = await bridge("create_calendar_event", payload);
      if (pinCreated.includes(c.id)) addedPins.push(result.identifier);
      undo.push({ op: "create", identifier: result.identifier, title: payload.title });
    }
  } catch (error) {
    try { await reverseSteps(undo); }
    catch (rollbackError) { throw new Error(`${error.message}; rollback also failed: ${rollbackError.message}`); }
    throw error;
  }
  const ids = new Set(priorPins[date] ?? []);
  for (const b of removed) ids.delete(b.calendarId);
  for (const id of [...pinIds, ...addedPins]) if (id) ids.add(id);
  savePins({ ...priorPins, [date]: [...ids] });
  if (!undo.length) return;
  mkdirSync(dirname(UNDO_FILE), { recursive: true });
  const history = (() => { try { return JSON.parse(readFileSync(UNDO_FILE, "utf8")); } catch { return []; } })();
  const last = history.at(-1);
  const next = group && last?.group === group
    ? [...history.slice(0, -1), { ...last, steps: [...last.steps, ...undo] }]
    : [...history, { pinsBefore: priorPins, at: new Date().toISOString(), ...(group ? { group } : {}), steps: undo }];
  writeFileSync(`${UNDO_FILE}.tmp`, JSON.stringify(next.slice(-10), null, 2));
  renameSync(`${UNDO_FILE}.tmp`, UNDO_FILE);
}

export async function undoLast() {
  const history = (() => { try { return JSON.parse(readFileSync(UNDO_FILE, "utf8")); } catch { return []; } })();
  // Skip empty entries older versions wrote: undo always undoes something real.
  while (history.length && !(history.at(-1).steps ?? []).length) history.pop();
  const last = history.pop();
  if (!last) return [];
  const { done, restored } = await reverseSteps(last.steps);
  if (last.pinsBefore) savePins(Object.fromEntries(Object.entries(last.pinsBefore).map(([date, ids]) => [date, ids.map(id => restored.get(id) ?? id)])));
  writeFileSync(UNDO_FILE, JSON.stringify(history, null, 2));
  return done;
}

/** Record steps made outside applyPlan (skipping one class occurrence) so "undo" reverses them. */
export function recordUndo(steps) {
  if (!steps.length) return;
  mkdirSync(dirname(UNDO_FILE), { recursive: true });
  const history = (() => { try { return JSON.parse(readFileSync(UNDO_FILE, "utf8")); } catch { return []; } })();
  writeFileSync(`${UNDO_FILE}.tmp`, JSON.stringify([...history, { at: new Date().toISOString(), steps }].slice(-10), null, 2));
  renameSync(`${UNDO_FILE}.tmp`, UNDO_FILE);
}
