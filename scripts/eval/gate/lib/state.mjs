// Snapshot, effect diff, undo and restore verification for one scenario item.
// The order that matters: snapshot, run, DIFF (recording what the item did), then undo, then verify.
// Immutable in spirit: every function returns new values and none edits a snapshot.
import { existsSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { run, sessionStatus } from "./live.mjs";
import { SANDBOX_FILES, sandboxDelta } from "./setup.mjs";
import { fixtureProblems, fixturesEffect, restoreFixtures } from "./fixtures.mjs";

// State files an item can change and that are restored byte for byte.
const CTRL_FILES = ["wake-request.json", "reminders.json", "watches.json", "watch.json", "pins.json", "task-sessions.json", "task-progress.json",
  "today-plan.json", "places.json", "health-log.json", "waiting.json", "orion-created-events.json", "orion-written.json", "checkins.json",
  "eval-checkins.json", "curiosity.json", "sleep-declared.json", "outreach-injected.json", "topic-sent.json", "projects.json", "life-config.json",
  "learned-routines.json", "patterns.json"];
const WORKSPACE_FILES = ["USER.md", "MEMORY.md"];
// Append-only inputs the item can add to; restored by truncation only when the old content is still a prefix.
// logged.jsonl (what he said he did; day-questions habitAnswer reads it): a gate item is not Nick, and the gym fixture appends to it.
// outreach.jsonl: the gate seeds a row per `replyToOutreach` text (lib/seed-outreach.mjs); truncation removes it.
const RESTORED_LOGS = ["inbound-turns.jsonl", "logged.jsonl"];
// outreach.jsonl is NOT truncated (REV4 item 7): the live system may append real rows during an item, and a truncation drops them.
// Only the rows the gate seeded are removed, matched by id; every other change is reported, not rewound.
const SEEDED_LOGS = ["outreach.jsonl"];
// Append-only records that are evidence (ledgers, audits): REPORTED, never rewound.
const REPORTED_LOGS = ["task-ledger.jsonl", "slips.jsonl", "held.jsonl", "life-history.jsonl", "focus-history.jsonl", "outbox.jsonl"];

const read = (p) => { try { return readFileSync(p, "utf8"); } catch { return null; } };
const entriesOf = (raw) => { try { return JSON.parse(raw ?? "[]").map((e) => JSON.stringify(e)); } catch { return []; } };
const memDir = (p) => join(p.workspace, "memory");
const memFiles = (p) => (existsSync(memDir(p)) ? readdirSync(memDir(p)).filter((f) => f.endsWith(".md")) : []);
const clip = (s, n = 300) => (s.length > n ? `${s.slice(0, n)}...` : s);

// Files live writers rewrite on their own schedule: restoring them would fight the writer, so they are never tracked.
const LIVE_FEEDS = new Set(["awareness.json", "now.json", "glance-calendar.json", "focus-activity.json", "focus-state.json", "focus-phone.json",
  "ontask-state.json", "messages-recent.json", "remote.json", "remote-link.json", "watchdog.json", "knowledge-graph.json", "computer-relay.key",
  "lights-status.json"]);
const MAX_TRACKED_BYTES = 1 << 20;
// REV2 finding 10 (2026-10-31): restoring every small .json rewound files the live system owns (location.json, remote-inbound.json,
// proactive-sent.json, cron-delivery.json, selfdev-*.json, permission-state.json, usage-cache.json, account-health.json,
// sleep-actual.json, morning-*.json): a restore wiped phone messages and re-sent pings. Only an allow-list is restored
// (CTRL_FILES + KNOWN_NEW_STATE); every other small top-level .json is snapshotted read-only and REPORTED when it changes, never written.
const KNOWN_NEW_STATE = ["declared-facts.json", "pending-answered.json", "pending-crisis.json", "chat-quiet.json", "ladders.json", "awake-late.json", "brief-heads.json", "model-outage-queue.json"];
const RESTORABLE = new Set([...CTRL_FILES, ...KNOWN_NEW_STATE]);
// The evaluation sandbox (lib/setup.mjs): created by the item's setup, removed byte for byte at undo, never "reported".
const SANDBOX = new Set(SANDBOX_FILES);
/** Small top-level .json files that are not restorable and not live feeds: watched and reported only. */
export function reportedFiles(p) {
  try {
    return readdirSync(p.ctrl).filter((f) => f.endsWith(".json") && !LIVE_FEEDS.has(f) && !RESTORABLE.has(f) && !SANDBOX.has(f)
      && (() => { try { return statSync(join(p.ctrl, f)).size <= MAX_TRACKED_BYTES; } catch { return false; } })());
  } catch { return []; }
}

/** The files a restore may write: the allow-list only. */
export const trackedFiles = (p) => [...RESTORABLE].map((f) => join(p.ctrl, f)).concat(WORKSPACE_FILES.map((f) => join(p.workspace, f)));

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
    seen: Object.fromEntries(reportedFiles(p).map((f) => [f, read(join(p.ctrl, f))])),
    mem: Object.fromEntries(memFiles(p).map((f) => [f, read(join(memDir(p), f))])),
    logs: Object.fromEntries([...RESTORED_LOGS, ...SEEDED_LOGS, ...REPORTED_LOGS].map((f) => [f, read(join(p.ctrl, f))])),
    sandbox: Object.fromEntries(SANDBOX_FILES.map((f) => [f, read(join(p.ctrl, f))])),
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

/**
 * Everything the item changed, measured against the snapshot. Call BEFORE restoring.
 * `seeded` is the sandbox day the item's setup wrote (null for a real-calendar item): its delta is the calendar effect.
 */
export async function effectSince(p, snap, { seeded = null } = {}) {
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
    && !trackedFiles(p).some((t) => t.endsWith(`/${f}`)) && ![...RESTORED_LOGS, ...SEEDED_LOGS, ...REPORTED_LOGS].includes(f) && !SANDBOX.has(f));
  // Live-owned state the item (or the live system) changed: what changed is reported; restoreState never touches these.
  const reported = [...new Set([...Object.keys(snap.seen ?? {}), ...Object.keys(after.seen ?? {})])].flatMap((f) => {
    const before = snap.seen?.[f] ?? null, now = after.seen?.[f] ?? null;
    return before === now ? [] : [{ path: f, kind: before === null ? "created" : now === null ? "deleted" : "changed", ...lineDelta(before, now) }];
  });
  const sandboxCalendar = sandboxDelta(seeded, (() => { try { return JSON.parse(after.sandbox?.["eval-calendar.json"] ?? "null"); } catch { return null; } })());
  const sandboxChanged = Boolean(sandboxCalendar && (sandboxCalendar.missing || Object.values(sandboxCalendar).some((v) => Array.isArray(v) && v.length)));
  const fixtures = fixturesEffect(p);
  return {
    calendar, sandboxCalendar, fixtures, files, memory, logs, todos: todoDelta, otherChanged, reported,
    session: { started: after.sessionId && after.sessionId !== snap.sessionId ? after.sessionId : null },
    changedAnything: Boolean(files.length || memory.length || calendar.newEntries.length || calendar.removedEntries.length
      || todoDelta.added.length || todoDelta.completed.length || logs.length || sandboxChanged || fixtures.some((f) => f.status !== "kept")),
  };
}

/** Put it all back. Returns what it did, as strings. */
export async function restoreState(p, snap, effect, { maxJournal = 10, seededOutreachIds = [] } = {}) {
  // The sandbox goes first: while eval-calendar.json and the marker exist, `orion-reschedule undo` would undo the
  // sandbox's journal instead of his.
  // Fixture files (vault notes, canary files) go first: the manifest naming them is itself a sandbox file.
  const actions = [...restoreFixtures(p), ...restoreSandbox(p, snap)];
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
  actions.push(...restoreSeededLogs(p, snap, seededOutreachIds));
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

const rowId = (line) => { try { return JSON.parse(line).id; } catch { return undefined; } };

/** Remove only the seeded rows (by id). Anything else that differs from the snapshot is reported, never rewound. */
function restoreSeededLogs(p, snap, seededIds) {
  const seeded = new Set(seededIds);
  const actions = [];
  for (const f of SEEDED_LOGS) {
    const file = join(p.ctrl, f), before = snap.logs[f], now = read(file);
    if (now === null || now === before) continue;
    const lines = now.split("\n").filter((l) => l !== "");
    const kept = lines.filter((l) => !seeded.has(rowId(l)));
    const removed = lines.length - kept.length;
    if (removed) {
      if (kept.length === 0 && before === null) rmSync(file, { force: true }); else writeFileSync(file, kept.map((l) => `${l}\n`).join(""));
      actions.push(`removed ${removed} seeded row(s) from ${f}`);
    }
    const beforeLines = new Set((before ?? "").split("\n").filter((l) => l !== ""));
    const other = kept.filter((l) => !beforeLines.has(l)).length;
    const gone = [...beforeLines].filter((l) => !kept.includes(l)).length;
    if (other || gone) actions.push(`REPORTED ${f}: ${other} other row(s) added, ${gone} removed by something else; not rewound`);
  }
  return actions;
}

/** Put the sandbox files back to what the snapshot saw (normally: none of them). */
export function restoreSandbox(p, snap) {
  const actions = [];
  for (const f of SANDBOX_FILES) {
    const file = join(p.ctrl, f), before = snap.sandbox?.[f] ?? null, now = read(file);
    if (now === before) continue;
    if (before === null) { rmSync(file, { force: true }); actions.push(`removed sandbox ${f}`); } else { writeFileSync(file, before); actions.push(`restored sandbox ${f}`); }
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
export async function verifyRestore(p, snap, { seededOutreachIds = [] } = {}) {
  const problems = [];
  for (const [f, before] of Object.entries(snap.files)) if (read(f) !== before) problems.push(`file differs: ${f}`);
  for (const f of new Set([...Object.keys(snap.mem), ...memFiles(p)])) if ((snap.mem[f] ?? null) !== read(join(memDir(p), f))) problems.push(`memory differs: ${f}`);
  for (const f of RESTORED_LOGS) if (read(join(p.ctrl, f)) !== snap.logs[f]) problems.push(`log differs: ${f}`);
  for (const f of SEEDED_LOGS) {
    const left = (read(join(p.ctrl, f)) ?? "").split("\n").filter((l) => seededOutreachIds.includes(rowId(l))).length;
    if (left) problems.push(`seeded rows left in ${f}: ${left}`);
  }
  if (read(p.undo) !== snap.undoRaw) problems.push("undo journal differs");
  for (const f of SANDBOX_FILES) if (read(join(p.ctrl, f)) !== (snap.sandbox?.[f] ?? null)) problems.push(`sandbox file differs: ${f}`);
  problems.push(...fixtureProblems(p));
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
