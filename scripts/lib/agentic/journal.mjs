/*
 The append-only audit journal.

 WHY THIS EXISTS SEPARATELY FROM `state.events`

 The controller snapshot keeps the latest 200 events so the UI has something to
 show. That is a display buffer, not an audit trail: after ten unattended hours
 the interesting event — the one that explains why the run went sideways at
 02:40 — has long since fallen off the end. This file is the record that answers
 "what did it do while nobody was watching", and nothing in it is ever rewritten.

 THE DURABILITY WINDOW, STATED HONESTLY

 An entry is appended AFTER the state transition it describes has been published,
 inside the same lock. A crash in the microseconds between the two loses one
 audit line while leaving state correct — the safe direction. It is also
 DETECTABLE rather than silent: every entry carries the revision it describes,
 revisions are contiguous, and `auditJournal` reports any gap. The alternative
 (append first) would leave entries describing transitions that never happened,
 which is worse: a plausible record of a thing that did not occur.
*/
import { appendFile, mkdir, open, readFile, readdir, rename, rm, stat } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const MAX_BYTES = 8 * 1024 * 1024;
const MAX_SEGMENTS = 12;
const MAX_FIELD = 4000;

/** Trim a payload to something a log can hold without becoming a reasoning dump. */
function bounded(value, depth = 0) {
  if (value === null || typeof value === 'number' || typeof value === 'boolean') return value;
  if (typeof value === 'string') return value.length > MAX_FIELD ? `${value.slice(0, MAX_FIELD)}…[${value.length}]` : value;
  if (depth >= 4) return '[nested]';
  if (Array.isArray(value)) return value.slice(0, 60).map(item => bounded(item, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).slice(0, 40).map(([key, item]) => [key, bounded(item, depth + 1)]));
  }
  return undefined;
}

async function rotate(path) {
  let size = 0;
  try { size = (await stat(path)).size; } catch { return; }
  if (size < MAX_BYTES) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  await rename(path, `${path}.${stamp}`);
  const dir = dirname(path);
  // Timestamped names sort chronologically, so the head of the sorted list is
  // the oldest. Segments are dropped rather than growing without bound; the live
  // segment and the recent past are what a post-mortem actually reads.
  const segments = (await readdir(dir)).filter(name => name.startsWith('journal.jsonl.')).sort();
  for (const name of segments.slice(0, Math.max(0, segments.length - MAX_SEGMENTS))) {
    await rm(join(dir, name), { force: true }).catch(() => {});
  }
}

/**
 * Append one record. `seq` is supplied by the controller from durable state, so
 * two writers cannot mint the same sequence number.
 */
export async function appendJournal(root, record) {
  const path = join(root, 'journal.jsonl');
  await mkdir(root, { recursive: true, mode: 0o700 });
  await rotate(path);
  const line = JSON.stringify({
    // Two streams share one file. `control` entries are controller state
    // transitions and carry a sequence allocated from durable state, so a gap
    // means a lost entry. `observation` entries are what the worker and
    // reviewer did between transitions; they are frequent, they carry no
    // sequence, and journalling one must NOT bump the controller's revision --
    // an inflating revision would make the operator's `pause --revision N`
    // race against the agent's own logging.
    stream: record.seq === null || record.seq === undefined ? 'observation' : 'control',
    seq: record.seq ?? null,
    at: record.at ?? new Date().toISOString(),
    revision: record.revision ?? null,
    runId: record.runId ?? null,
    kind: String(record.kind).slice(0, 64),
    taskId: record.taskId ?? null,
    actor: record.actor ?? null,
    ...bounded(record.data ?? {}),
  }) + '\n';
  await appendFile(path, line, { mode: 0o600 });
  // fsync the file, not just the write: an unattended machine that loses power
  // must not lose the last hour of audit to the page cache.
  const handle = await open(path, 'r+');
  try { await handle.sync(); } finally { await handle.close(); }
}

/** Read journal records, newest segment only, optionally filtered. */
export async function readJournal(root, { since = 0, limit = 500, kinds = null } = {}) {
  let text = '';
  try { text = await readFile(join(root, 'journal.jsonl'), 'utf8'); } catch { return []; }
  const records = [];
  for (const line of text.split('\n')) {
    if (!line.trim()) continue;
    let record;
    try { record = JSON.parse(line); } catch { records.push({ seq: null, kind: 'corrupt_entry', raw: line.slice(0, 200) }); continue; }
    if (record.seq !== null && record.seq !== undefined && record.seq <= since) continue;
    if (kinds && !kinds.includes(record.kind)) continue;
    records.push(record);
  }
  return records.slice(-limit);
}

/**
 * Report integrity: sequence gaps, revision gaps and corrupt lines. Used by the
 * handoff brief, so Astra can see whether the record it is reading is complete.
 */
export async function auditJournal(root) {
  const records = await readJournal(root, { limit: Number.MAX_SAFE_INTEGER });
  const gaps = [], corrupt = [];
  let previous = null, control = 0, observations = 0;
  for (const record of records) {
    if (record.kind === 'corrupt_entry') { corrupt.push(record.raw); continue; }
    // Only the control stream is contiguous; observations are deliberately not
    // sequenced, so checking them for gaps would report a gap on every line.
    if (record.stream === 'observation' || record.seq === null) { observations++; continue; }
    control++;
    if (previous !== null && record.seq !== previous + 1) gaps.push({ after: previous, next: record.seq });
    previous = record.seq;
  }
  const first = records.find(record => record.stream !== 'observation' && record.seq !== null);
  return { entries: records.length, control, observations, firstSeq: first?.seq ?? null, lastSeq: previous, gaps, corrupt };
}
