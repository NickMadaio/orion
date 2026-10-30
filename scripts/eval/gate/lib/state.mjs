// Snapshot, effect diff, undo and restore verification for one scenario item.
// The order that matters: snapshot, run, DIFF (recording what the item did), then undo, then verify.
// Immutable in spirit: every function returns new values and none edits a snapshot.
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run, sessionStatus } from "./live.mjs";

// State files an item can change and that are restored byte for byte.
const CTRL_FILES = ["wake-request.json", "reminders.json", "watches.json", "watch.json", "pins.json", "task-sessions.json", "task-progress.json",
  "today-plan.json", "places.json", "health-log.json", "waiting.json", "orion-created-events.json", "orion-written.json", "checkins.json",
  "eval-checkins.json", "curiosity.json", "sleep-declared.json", "outreach-injected.json", "topic-sent.json", "projects.json", "life-config.json",
  "learned-routines.json", "patterns.json"];
const WORKSPACE_FILES = ["USER.md", "MEMORY.md"];
// Append-only inputs the item can add to; restored by truncation only when the old content is still a prefix.
const RESTORED_LOGS = ["inbound-turns.jsonl"];
// Append-only records that are evidence (ledgers, audits): REPORTED, never rewound.
const REPORTED_LOGS = ["task-ledger.jsonl", "slips.jsonl", "held.jsonl", "outreach.jsonl", "life-history.jsonl", "focus-history.jsonl", "outbox.jsonl"];

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const entriesOf = (raw) => { try { return JSON.parse(raw ?? "[]").map((e) => JSON.stringify(e)); } catch { return []; } };
const memDir = (p) => join(p.workspace, "memory");
const memFiles = (p) => (existsSync(memDir(p)) ? readdirSync(memDir(p)).filter((f) => f.endsWith(".md")) : []);
const clip = (s, n = 300) => (s.length > n ? `${s.slice(0, n)}...` : s);

export const trackedFiles = (p) => [...CTRL_FILES.map((f) => join(p.ctrl, f)), ...WORKSPACE_FILES.map((f) => join(p.workspace, f))];

async function todos(p) {
  try {
    const { bridgeRequest } = await import(join(p.scripts, "lib/life/bridge-path.mjs"));
    const r = await bridgeRequest("list_incomplete_reminders", { list: "Orion" });
    return JSON.parse(r.reminders_json ?? "[]").map((t) => ({ id: t.identifier, title: t.title }));
  } catch { return null; }
}

function topLevelMtimes(p) {
  const out = {};
  try { for (const f of readdirSync(p.ctrl)) { try { out[f] = statSync(join(p.ctrl, f)).mtimeMs; } catch { /* gone */ } } } catch { /* no dir */ }
  return out;
}

export async function snapshotState(p) {
  const status = await sessionStatus(p);
  return {
    files: Object.fromEntries(trackedFiles(p).map((f) => [f, read(f)])),
    mem: Object.fromEntries(memFiles(p).map((f) => [f, read(join(memDir(p), f))])),
    logs: Object.fromEntries([...RESTORED_LOGS, ...REPORTED_LOGS].map((f) => [f, read(join(p.ctrl, f))])),
    undoRaw: read(p.undo),
    todos: await todos(p),
    sessionId: status && ["running", "paused", "waiting-for-return"].includes(status.status) ? status.sessionId : null,
    mtimes: topLevelMtimes(p),
  };
}

/** Lines added and removed between two texts (order-insensitive: enough to say what an item changed). */
export function lineDelta(before, after) {
  const count = (t) => { const m = new Map(); for (const l of (t ?? "").split("\n")) if (l.trim()) m.set(l, (m.get(l) ?? 0) + 1); return m; };
  const b = count(before), a = count(after);
  const diff = (x, y) => [...x].flatMap(([l, n]) => Array(Math.max(0, n - (y.get(l) ?? 0))).fill(l)).map((l) => clip(l)).slice(0, 60);
  return { added: diff(a, b), removed: diff(b, a) };
}

/** Everything the item changed, measured against the snapshot. Call BEFORE restoring. */
export async function effectSince(p, snap) {
  const after = await snapshotState(p);
  const files = Object.entries(snap.files).flatMap(([f, before]) => {
    const now = after.files[f];
    if (now === before) return [];
    return [{ path: f, kind: before === null ? "created" : now === null ? "deleted" : "changed", ...lineDelta(before, now) }];
  });
  const memory = [...new Set([...Object.keys(snap.mem), ...Object.keys(after.mem)])].flatMap((f) => {
    const before = snap.mem[f] ?? null, now = after.mem[f] ?? null;
    return before === now ? [] : [{ path: `memory/${f}`, kind: before === null ? "created" : now === null ? "deleted" : "changed", ...lineDelta(before, now) }];
  });
  const logs = Object.entries(snap.logs).flatMap(([f, before]) => {
    const now = after.logs[f];
    if (now === before) return [];
    const appended = before !== null && (now ?? "").startsWith(before) ? (now ?? "").slice(before.length).split("\n").filter(Boolean).map((l) => clip(l, 500)) : null;
    return [{ path: f, appended, rewritten: appended === null }];
  });
  const old = new Set(entriesOf(snap.undoRaw));
  const nowEntries = entriesOf(read(p.undo));
  const calendar = {
    newEntries: nowEntries.filter((e) => !old.has(e)).map((e) => JSON.parse(e)),
    removedEntries: [...old].filter((e) => !nowEntries.includes(e)).map((e) => JSON.parse(e)),
  };
  const had = new Set((snap.todos ?? []).map((t) => t.id)), has = new Set((after.todos ?? []).map((t) => t.id));
  const todoDelta = snap.todos && after.todos
    ? { added: after.todos.filter((t) => !had.has(t.id)), completed: snap.todos.filter((t) => !has.has(t.id)) }
    : { added: [], completed: [], unavailable: true };
  const otherChanged = Object.keys(after.mtimes).filter((f) => after.mtimes[f] !== snap.mtimes[f]
    && !trackedFiles(p).some((t) => t.endsWith(`/${f}`)) && ![...RESTORED_LOGS, ...REPORTED_LOGS].includes(f));
  return {
    calendar, files, memory, logs, todos: todoDelta, otherChanged,
    session: { started: after.sessionId && after.sessionId !== snap.sessionId ? after.sessionId : null },
    changedAnything: Boolean(files.length || memory.length || calendar.newEntries.length || calendar.removedEntries.length
      || todoDelta.added.length || todoDelta.completed.length || logs.length),
  };
}

/** Put it all back. Returns what it did, as strings. */
export async function restoreState(p, snap, effect, { maxJournal = 10 } = {}) {
  const actions = [];
  const grew = effect.calendar.newEntries.length;
  for (let i = 0; i < Math.min(grew, maxJournal); i++) {
    const r = await run(p.node, [join(p.scripts, "orion-reschedule"), "undo"], { timeoutMs: 60000 });
    actions.push(`calendar undo: ${(r.stdout || r.stderr).trim().slice(0, 200)}`);
  }
  if (grew > maxJournal) actions.push(`UNDO INCOMPLETE: ${grew} changes but the journal keeps ${maxJournal}`);
  // Each new entry pushed one of his older ones out (cap 10); once every undo worked, put his history back.
  if (grew > 0 && actions.filter((a) => a.startsWith("calendar undo")).every((a) => /^calendar undo: Undone:/.test(a)) && grew <= maxJournal) {
    writeFileSync(p.undo, snap.undoRaw ?? "[]"); actions.push("undo journal restored");
  } else if (grew > 0) actions.push("UNDO INCOMPLETE: journal left as is");
  if (effect.calendar.removedEntries.length) actions.push(`HAZARD: the item undid ${effect.calendar.removedEntries.length} earlier change(s) of his; not restorable here`);
  for (const [f, before] of Object.entries(snap.files)) {
    const now = read(f);
    if (now === before) continue;
    if (before === null) { rmSync(f, { force: true }); actions.push(`removed new ${f}`); } else { writeFileSync(f, before); actions.push(`restored ${f}`); }
  }
  for (const f of memFiles(p)) {
    const file = join(memDir(p), f), before = snap.mem[f];
    if (before === undefined) { rmSync(file, { force: true }); actions.push(`removed new memory/${f}`); } else if (read(file) !== before) { writeFileSync(file, before); actions.push(`restored memory/${f}`); }
  }
  for (const f of RESTORED_LOGS) {
    const file = join(p.ctrl, f), before = snap.logs[f], now = read(file);
    if (now === before) continue;
    if (before !== null && (now ?? "").startsWith(before)) { writeFileSync(file, before); actions.push(`truncated ${f}`); } else actions.push(`NOT RESTORED ${f}: rewritten by something else`);
  }
  actions.push(...await restoreTodos(p, snap));
  const status = await sessionStatus(p);
  const live = status && ["running", "paused", "waiting-for-return"].includes(status.status) ? status.sessionId : null;
  if (live && live !== snap.sessionId) {
    await run(p.node, [join(p.scripts, "orion-session"), "abandon"], { timeoutMs: 15000 });
    await run(p.node, [join(p.scripts, "orion-session"), "release"], { timeoutMs: 15000 });
    actions.push(`abandoned new session ${live}`);
  }
  return actions;
}

/** To-dos are Apple Reminders: complete what the item added, reopen what it completed. */
async function restoreTodos(p, snap) {
  const after = await todos(p);
  if (!snap.todos || !after) return [];
  const actions = [];
  try {
    const { bridgeRequest } = await import(join(p.scripts, "lib/life/bridge-path.mjs"));
    const had = new Set(snap.todos.map((t) => t.id)), has = new Set(after.map((t) => t.id));
    for (const t of after.filter((x) => !had.has(x.id))) { await bridgeRequest("complete_reminder", { identifier: t.id }).catch(() => {}); actions.push(`completed new to-do "${t.title}"`); }
    for (const t of snap.todos.filter((x) => !has.has(x.id))) { await bridgeRequest("complete_reminder", { identifier: t.id, completed: "false" }).catch(() => {}); actions.push(`reopened to-do "${t.title}"`); }
  } catch (e) { actions.push(`TODO RESTORE FAILED: ${e.message}`); }
  return actions;
}

/** Re-read everything and compare with the snapshot. ok=false lists exactly what did not come back. */
export async function verifyRestore(p, snap) {
  const problems = [];
  for (const [f, before] of Object.entries(snap.files)) if (read(f) !== before) problems.push(`file differs: ${f}`);
  for (const f of new Set([...Object.keys(snap.mem), ...memFiles(p)])) if ((snap.mem[f] ?? null) !== read(join(memDir(p), f))) problems.push(`memory differs: ${f}`);
  for (const f of RESTORED_LOGS) if (read(join(p.ctrl, f)) !== snap.logs[f]) problems.push(`log differs: ${f}`);
  if (read(p.undo) !== snap.undoRaw) problems.push("undo journal differs");
  const after = await todos(p);
  if (snap.todos && after) {
    const a = new Set(snap.todos.map((t) => t.id)), b = new Set(after.map((t) => t.id));
    if (a.size !== b.size || [...a].some((id) => !b.has(id))) problems.push("to-do list differs");
  }
  const status = await sessionStatus(p);
  const live = status && ["running", "paused", "waiting-for-return"].includes(status.status) ? status.sessionId : null;
  if (live !== snap.sessionId) problems.push("focus session differs");
  return { ok: problems.length === 0, problems };
}
