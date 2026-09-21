/*
 The durable controller. It owns workflow state; models own nothing.

 Schema v2. v1 was the reviewed foundation Astra left: one task per invocation,
 fixture worker/verify adapters, accept-or-reject reviews, no escalation state
 and no audit beyond a 200-entry display buffer. Everything v1 enforced is still
 enforced here. What is new is what an unattended overnight run needs:

   * full task contracts (contract.mjs), so scope and non-scope are data the
     boundary and the reviewer act on rather than prose in a prompt
   * PASS_WITH_TASKS -- a review may accept work AND return explicit corrections
     as new tasks, bounded in depth and count so scope cannot grow forever
   * reviewer-authored repairs recorded SEPARATELY from reviews, because a
     reviewer that quietly writes the code it then approves has destroyed the
     independence that made its approval worth anything
   * an escalation state the loop cannot clear for itself
   * an append-only journal, so the run is auditable after the display buffer
     has rolled over

 There is still no model, shell, git, deployment or review transport in this
 file. Adapters are supplied by the host and this module trusts them to be the
 trusted ones; `scripts/lib/agentic/` builds the real ones.

 v2 state is not migrated from v1. No production v1 state was ever created --
 the handoff verified the path absent -- so there is nothing to migrate, and a
 migration path nobody needs is a code path nobody tests.
*/
import { mkdir, open, readFile, rename, rmdir } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { contractDigest, normalizeTaskContract, normalizeTaskGraph } from './agentic/contract.mjs';
import { appendJournal } from './agentic/journal.mjs';

export const RUN_STATES = ['ready', 'running', 'paused', 'waiting_for_review', 'interrupted', 'budget_exhausted', 'escalated', 'completed'];
export const TASK_STATES = ['queued', 'running', 'awaiting_review', 'accepted', 'blocked'];
export const STAGES = ['queued', 'inspect', 'implement', 'test', 'review', 'repair', 'accepted'];
export const DECISIONS = ['accept', 'accept_with_tasks', 'changes_requested', 'blocked'];

const clone = value => structuredClone(value);
const stamp = () => new Date().toISOString();
const isSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

/** Records queued during a transaction and flushed to the journal after publish. */
function pending(state) {
  if (!Object.hasOwn(state, '_pending')) {
    Object.defineProperty(state, '_pending', { value: [], writable: true, enumerable: false, configurable: true });
  }
  return state._pending;
}

function event(state, kind, message, data = {}) {
  state.events.push({ at: stamp(), kind, message: String(message).slice(0, 500) });
  state.events = state.events.slice(-200);
  state.journalSeq += 1;
  pending(state).push({ seq: state.journalSeq, kind, runId: state.runId, taskId: data.taskId ?? state.activeTask ?? null,
    actor: data.actor ?? 'controller', data: { message: String(message), ...data } });
}

async function publish(root, state, initial = false) {
  const target = join(root, 'state.json'), temporary = join(root, `${randomUUID()}.tmp`);
  const handle = await open(initial ? target : temporary, 'wx', 0o600);
  try { await handle.writeFile(JSON.stringify(state) + '\n'); await handle.sync(); }
  finally { await handle.close(); }
  if (!initial) await rename(temporary, target);
  const dir = await open(root, 'r'); try { await dir.sync(); } finally { await dir.close(); }
}

function validateRuntimeFields(state) {
  const fail = message => { throw new Error(`invalid controller state: ${message}`); };
  if (state.version !== 2) fail('unsupported schema version');
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) fail('revision');
  if (!Number.isSafeInteger(state.journalSeq) || state.journalSeq < 0) fail('journalSeq');
  if (typeof state.runId !== 'string' || !state.runId) fail('runId');
  if (typeof state.finalReview !== 'boolean' || typeof state.pauseRequested !== 'boolean') fail('flags');
  if (!Number.isInteger(state.maxAttempts) || state.maxAttempts < 1 || state.maxAttempts > 10) fail('maxAttempts must be 1-10');
  if (!Number.isInteger(state.maxCorrectionDepth) || state.maxCorrectionDepth < 0 || state.maxCorrectionDepth > 3) fail('maxCorrectionDepth must be 0-3');
  if (!RUN_STATES.includes(state.status)) fail('status');
  for (const field of ['tasks', 'events', 'steering', 'reviews', 'repairs']) {
    if (!Array.isArray(state[field])) fail(field);
  }
}

export async function readProjectAgent(root) {
  const state = JSON.parse(await readFile(join(root, 'state.json'), 'utf8'));
  validateRuntimeFields(state);
  // Contract validity is checked by the schema authority, so "what a task is"
  // has one definition and a hand-edited state file cannot smuggle in a task
  // with an empty scope or an unregistered check.
  normalizeTaskGraph(state.tasks);

  for (const task of state.tasks) {
    const bad = reason => { throw new Error(`invalid task lifecycle (${task.id}): ${reason}`); };
    if (!TASK_STATES.includes(task.status)) bad('status');
    if (!STAGES.includes(task.stage)) bad('stage');
    if (!Number.isInteger(task.attempts) || task.attempts < 0 || task.attempts > state.maxAttempts) bad('attempts');
    if (task.status !== 'queued' && task.attempts < 1) bad('a started task has at least one attempt');
    if (!Number.isInteger(task.corrections) || task.corrections < 0 || task.corrections > 100) bad('corrections');
    if (!Number.isInteger(task.repairsUsed) || task.repairsUsed < 0 || task.repairsUsed > 3) bad('repairsUsed');
    if (!Number.isInteger(task.correctionDepth) || task.correctionDepth < 0 || task.correctionDepth > state.maxCorrectionDepth) bad('correctionDepth');
    if (['awaiting_review', 'accepted'].includes(task.status) ? !isSha(task.commit) : task.commit !== null) bad('commit');
    if (task.status === 'accepted' && task.stage !== 'accepted') bad('accepted stage');
    if (task.status === 'awaiting_review' && task.stage !== 'review') bad('awaiting-review stage');
    if (task.blocker !== null && typeof task.blocker !== 'string') bad('blocker');
    if (task.origin !== 'plan' && task.correctionDepth < 1) bad('a review-authored task must record its correction depth');
    // Evidence exists only while a checkpoint is awaiting review. Keeping it
    // out of every other state stops the snapshot growing without bound, and
    // stops a stale check result from being read as this attempt's.
    if (task.status === 'awaiting_review') {
      if (!task.evidence || typeof task.evidence !== 'object' || typeof task.evidence.summary !== 'string' ||
          !Array.isArray(task.evidence.checks) || !Array.isArray(task.evidence.files)) bad('evidence');
      if (!task.evidence.checks.every(check => typeof check.name === 'string' && typeof check.ok === 'boolean')) bad('evidence checks');
    } else if (task.evidence !== null) bad('evidence is only carried by a task awaiting review');
  }

  const running = state.tasks.filter(task => task.status === 'running');
  const fail = message => { throw new Error(`inconsistent controller lifecycle: ${message}`); };
  if (running.length > 1) fail('more than one running task');
  if (running.length === 1 ? (state.activeTask !== running[0].id || state.status !== 'running') : state.activeTask !== null) fail('activeTask disagrees with the running task');
  if (state.status === 'running' && running.length !== 1) fail('running with no running task');
  if (state.finalReview && (state.status !== 'completed' || !state.tasks.every(task => task.status === 'accepted'))) fail('final review without a completed, fully accepted run');
  if (!state.finalReview && state.status === 'completed') fail('completed without final review');
  if ((state.status === 'escalated') !== (state.escalation !== null && state.escalation !== undefined)) fail('escalated status and escalation record must agree');

  if (state.escalation) {
    const escalation = state.escalation;
    if (typeof escalation.id !== 'string' || !escalation.id || typeof escalation.reason !== 'string' || !escalation.reason ||
        typeof escalation.kind !== 'string' || typeof escalation.notified !== 'boolean' ||
        (escalation.taskId !== null && !state.tasks.some(task => task.id === escalation.taskId))) fail('escalation record');
  }
  for (const item of state.steering) {
    if (typeof item.id !== 'string' || typeof item.text !== 'string' || typeof item.applied !== 'boolean') fail('steering');
  }
  for (const item of state.events) {
    if (typeof item.kind !== 'string' || typeof item.message !== 'string' || !Number.isFinite(Date.parse(item.at))) fail('event');
  }
  for (const item of state.reviews) {
    if (!state.tasks.some(task => task.id === item.taskId) || !isSha(item.commit) || !DECISIONS.includes(item.decision) ||
        !Number.isSafeInteger(item.revision) || item.revision < 0 || item.revision >= state.revision) fail('review');
  }
  for (const item of state.repairs) {
    if (!state.tasks.some(task => task.id === item.taskId) || !Array.isArray(item.files) || typeof item.summary !== 'string' ||
        typeof item.model !== 'string' || !Number.isSafeInteger(item.revision) || item.revision >= state.revision) fail('repair');
  }
  return state;
}

/**
 * The single writer. Serialized by `state.lock`; `expected` refuses a write
 * built on a snapshot someone else has already superseded.
 */
async function transaction(root, expected, update) {
  const lock = join(root, 'state.lock');
  await mkdir(lock, { mode: 0o700 });
  try {
    const state = await readProjectAgent(root);
    if (expected !== undefined && state.revision !== expected) throw new Error('state revision changed; refresh first');
    await update(state);
    state.revision++;
    await publish(root, state);
    // After publish, inside the lock. A crash here loses one audit line and
    // leaves state correct; `auditJournal` reports the resulting revision gap.
    for (const record of pending(state)) {
      await appendJournal(root, { ...record, revision: state.revision }).catch(() => {});
    }
    state._pending = [];
    return state;
  } finally { await rmdir(lock); }
}

/** Escape hatch for the trusted host layers; the same lock and the same validation. */
export async function mutateProjectAgent(root, expected, update) {
  return transaction(root, expected, update);
}

export async function initializeProjectAgent(root, tasks, { maxAttempts = 3, maxCorrectionDepth = 2 } = {}) {
  const contracts = normalizeTaskGraph(tasks);
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 10) throw new Error('invalid attempts');
  if (!Number.isInteger(maxCorrectionDepth) || maxCorrectionDepth < 0 || maxCorrectionDepth > 3) throw new Error('invalid correction depth');
  await mkdir(root, { recursive: true, mode: 0o700 });
  const state = {
    version: 2, revision: 0, runId: randomUUID(), status: 'ready', activeTask: null,
    pauseRequested: false, maxAttempts, maxCorrectionDepth, finalReview: false, journalSeq: 0,
    escalation: null, steering: [], reviews: [], repairs: [], events: [],
    tasks: contracts.map(contract => ({ ...clone(contract), status: 'queued', stage: 'queued', attempts: 0, corrections: 0, correctionDepth: 0, repairsUsed: 0, commit: null, blocker: null, evidence: null })),
  };
  event(state, 'initialized', `Approved task graph loaded: ${contracts.length} task(s). Execution adapters are not enabled by initialization.`,
    { actor: 'operator', tasks: contracts.map(contract => ({ id: contract.id, digest: contractDigest(contract) })) });
  await publish(root, state, true);
  for (const record of pending(state)) await appendJournal(root, { ...record, revision: 0 }).catch(() => {});
  state._pending = [];
  return state;
}

export async function steerProjectAgent(root, command, revision, text) {
  if (!Number.isSafeInteger(revision)) throw new Error('revision required');
  return transaction(root, revision, state => {
    if (state.status === 'completed') throw new Error('run completed');
    if (command === 'pause') {
      state.pauseRequested = true;
      if (!state.activeTask && state.status !== 'escalated') state.status = 'paused';
      event(state, 'pause', state.activeTask ? 'Pause requested; waiting for task boundary.' : 'Paused.', { actor: 'operator' });
    } else if (command === 'resume') {
      if (state.activeTask || state.status === 'interrupted') throw new Error('reconcile interrupted work before resuming');
      if (state.status === 'escalated') throw new Error('resolve the escalation before resuming');
      state.pauseRequested = false;
      state.status = state.tasks.some(task => task.status === 'awaiting_review') ? 'waiting_for_review' : 'ready';
      event(state, 'resume', 'Resume requested; review gates remain enforced.', { actor: 'operator' });
    } else if (command === 'steer') {
      if (typeof text !== 'string' || !text.trim() || text.length > 2000) throw new Error('invalid steering');
      state.steering.push({ id: randomUUID(), text, applied: false });
      event(state, 'steering_received', 'Instruction queued for the next task boundary.', { actor: 'operator' });
    } else throw new Error('unknown control');
  });
}

/**
 * Raise an escalation and halt. Nothing inside the loop may clear this; only
 * `resolveProjectEscalation`, which is an operator action, can. That asymmetry
 * is the point: the system that decided it needs a human must not also be the
 * system that decides it no longer does.
 */
export async function escalateProjectAgent(root, revision, { kind, reason, taskId = null, question = null, recommendAstra = false, detail = {} }) {
  return transaction(root, revision, state => {
    if (state.status === 'completed') throw new Error('run completed');
    if (typeof kind !== 'string' || !kind.trim() || typeof reason !== 'string' || !reason.trim()) throw new Error('escalation needs a kind and a reason');
    if (taskId !== null && !state.tasks.some(task => task.id === taskId)) throw new Error('escalation names no task in this run');
    if (state.activeTask) throw new Error('escalate at a task boundary, not mid-task');
    if (state.escalation) return;
    state.escalation = { id: randomUUID(), at: stamp(), kind: kind.trim().slice(0, 64), reason: reason.trim().slice(0, 2000),
      taskId, question: question ? String(question).slice(0, 1000) : null, recommendAstra: Boolean(recommendAstra),
      notified: false, notifiedAt: null };
    state.status = 'escalated';
    event(state, 'escalated', `${kind}: ${reason}`, { taskId, detail, actor: 'controller' });
  });
}

/** Record that the owner was told; separates "needs a human" from "a human knows". */
export async function markEscalationNotified(root, revision, escalationId) {
  return transaction(root, revision, state => {
    if (!state.escalation || state.escalation.id !== escalationId) throw new Error('no such escalation');
    state.escalation.notified = true;
    state.escalation.notifiedAt = stamp();
    event(state, 'escalation_notified', 'Owner alerted.', { actor: 'controller' });
  });
}

export async function resolveProjectEscalation(root, revision, note) {
  return transaction(root, revision, state => {
    if (!state.escalation) throw new Error('no escalation to resolve');
    const resolved = state.escalation;
    state.escalation = null;
    state.status = state.pauseRequested ? 'paused' : state.tasks.some(task => task.status === 'awaiting_review') ? 'waiting_for_review' : 'ready';
    event(state, 'escalation_resolved', `${resolved.kind} resolved: ${String(note ?? 'no note').slice(0, 500)}`, { actor: 'operator', escalationId: resolved.id });
  });
}

/**
 * Move a run out of `interrupted`.
 *
 * `interrupted` means a worker was cancelled with an UNKNOWN outcome, and the
 * one thing that must never happen next is a second writer starting against the
 * same worktree while the first is still alive. So this requires the caller to
 * pass evidence that the worker lease holder is provably dead -- see
 * `agentic/lease.mjs`, which is the only thing that produces it. The evidence is
 * recorded, not just checked: a reconciliation nobody can audit afterwards is
 * indistinguishable from someone deleting a lock file because it was annoying.
 *
 * The interrupted task stays blocked. Its attempt was spent and its outcome is
 * unknown, so the normal blocked-task path decides what happens next.
 */
export async function reconcileInterruptedRun(root, revision, { deadOwnerProof }) {
  return transaction(root, revision, state => {
    if (state.status !== 'interrupted') throw new Error('the run is not interrupted');
    if (!deadOwnerProof || deadOwnerProof.dead !== true || typeof deadOwnerProof.reason !== 'string' || !deadOwnerProof.reason) {
      throw new Error('reconciliation requires proof that the worker lease holder is dead');
    }
    if (state.activeTask) {
      const task = state.tasks.find(item => item.id === state.activeTask);
      task.status = 'blocked';
      task.stage = 'queued';
      task.commit = null;
      task.evidence = null;
      task.blocker = 'worker_outcome_unknown';
      state.activeTask = null;
    }
    state.status = state.pauseRequested ? 'paused' : state.tasks.some(item => item.status === 'awaiting_review') ? 'waiting_for_review' : 'ready';
    event(state, 'reconciled', `Interrupted run reconciled: ${deadOwnerProof.reason}`,
      { actor: 'supervisor', proof: deadOwnerProof });
  });
}

function appendCorrections(state, task, corrections, reviewId) {
  const depth = task.correctionDepth + 1;
  if (depth > state.maxCorrectionDepth) {
    throw new Error(`correction depth ${depth} exceeds the limit of ${state.maxCorrectionDepth}; this belongs in an escalation, not another task`);
  }
  const existing = new Set(state.tasks.map(item => item.id));
  const added = [];
  for (const [index, raw] of corrections.entries()) {
    // Ids are minted here, not taken from the model: a review that could choose
    // an id could choose one that already exists and silently redefine a task.
    let id = `${task.id}-fix${depth}-${index + 1}`;
    let suffix = 1;
    while (existing.has(id)) id = `${task.id}-fix${depth}-${index + 1}-${++suffix}`;
    // A correction inherits the parent's approved scope by default. It may
    // narrow it; it may never widen it, because that would let a review grant
    // the worker access a human never approved. Checked BEFORE normalizing so
    // the refusal names the real cause rather than "scope must not be empty".
    const requested = Array.isArray(raw.scope) && raw.scope.length ? raw.scope : task.scope;
    const narrowed = requested.filter(entry =>
      task.scope.some(allowed => (allowed.endsWith('/') ? String(entry).startsWith(allowed) : entry === allowed)));
    if (!narrowed.length) {
      throw new Error(`correction "${id}" would need scope outside the parent task's approved scope ` +
        `(asked for ${requested.join(', ')}; ${task.id} may only change ${task.scope.join(', ')})`);
    }
    const contract = normalizeTaskContract({
      ...raw,
      id,
      scope: narrowed,
      checks: Array.isArray(raw.checks) && raw.checks.length ? raw.checks : task.checks,
      weight: Number.isInteger(raw.weight) ? Math.min(raw.weight, task.weight) : 1,
      dependencies: [task.id],
      risk: raw.risk ?? task.risk,
      origin: 'review_correction',
      originReview: reviewId,
    });
    existing.add(id);
    added.push({ ...clone(contract), status: 'queued', stage: 'queued', attempts: 0, corrections: 0, correctionDepth: depth, repairsUsed: 0, commit: null, blocker: null, evidence: null });
  }
  return added;
}

/**
 * The review gate. Only a trusted reviewer adapter calls this; the worker is
 * never handed it and cannot accept its own work.
 */
export async function reviewProjectTask(root, { revision, taskId, commit, decision, review = {} }) {
  if (!Number.isSafeInteger(revision)) throw new Error('review revision required');
  return transaction(root, revision, state => {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task || task.status !== 'awaiting_review' || task.commit !== commit || !isSha(commit) || !DECISIONS.includes(decision)) {
      throw new Error('stale or invalid review');
    }
    const reviewId = randomUUID();
    const digest = contractDigest(normalizeTaskContract(task));
    if (review.contractDigest && review.contractDigest !== digest) {
      throw new Error('this review examined a different version of the contract; re-review the current one');
    }

    let added = [];
    if (decision === 'accept' || decision === 'accept_with_tasks') {
      if (decision === 'accept_with_tasks') added = appendCorrections(state, task, review.corrections ?? [], reviewId);
      task.status = 'accepted'; task.stage = 'accepted'; task.blocker = null; task.evidence = null;
    } else if (decision === 'changes_requested') {
      task.corrections += 1;
      const exhausted = task.attempts >= state.maxAttempts;
      task.status = exhausted ? 'blocked' : 'queued';
      task.stage = 'queued';
      task.commit = null;
      task.evidence = null;
      task.blocker = exhausted ? 'repair_budget_exhausted' : null;
    } else {
      task.status = 'blocked'; task.stage = 'queued'; task.commit = null; task.evidence = null;
      task.blocker = review.escalationReason ? `review_blocked: ${String(review.escalationReason).slice(0, 300)}` : 'review_blocked';
    }

    if (added.length) {
      state.tasks.push(...added);
      normalizeTaskGraph(state.tasks);
    }
    state.reviews.push({ id: reviewId, taskId, commit, decision, revision, at: stamp(),
      contractDigest: digest,
      reviewer: String(review.reviewer ?? 'unknown').slice(0, 120),
      verdict: String(review.verdict ?? decision).slice(0, 32),
      summary: String(review.summary ?? '').slice(0, 1500),
      failed: Array.isArray(review.failed) ? review.failed.slice(0, 30) : [],
      correctionIds: added.map(item => item.id) });
    state.status = state.pauseRequested ? 'paused' : 'ready';
    event(state, 'review', `${taskId}: ${decision}${added.length ? ` (+${added.length} correction task(s))` : ''}`,
      { taskId, actor: 'reviewer', decision, reviewId, reviewer: review.reviewer ?? null, summary: review.summary ?? null });
  });
}

/**
 * Record a reviewer-authored code change. Kept out of `reviews` on purpose:
 * Astra must be able to see, at a glance, every place the reviewer crossed from
 * reviewing into implementing.
 */
export async function recordReviewerRepair(root, revision, { taskId, reviewId = null, model, files, summary, commit = null }) {
  return transaction(root, revision, state => {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task) throw new Error('repair names no task in this run');
    if (!Array.isArray(files) || !files.length || files.length > 20) throw new Error('a repair must name 1-20 files');
    if (typeof summary !== 'string' || !summary.trim()) throw new Error('a repair must carry a summary');
    if (commit !== null && !isSha(commit)) throw new Error('invalid repair commit');
    state.repairs.push({ id: randomUUID(), at: stamp(), revision, taskId, reviewId,
      model: String(model ?? 'unknown').slice(0, 120), files: files.map(file => String(file).slice(0, 300)),
      summary: summary.trim().slice(0, 1500), commit });
    event(state, 'reviewer_repair', `${taskId}: reviewer edited ${files.length} file(s)`,
      { taskId, actor: 'reviewer', files, summary: summary.trim(), model });
  });
}

/**
 * Return a blocked task to the worker after a reviewer repair, with exactly ONE
 * further attempt.
 *
 * The attempt counter is set to `maxAttempts - 1` rather than reset to zero on
 * purpose. A repair is meant to unblock a worker, not to hand it a fresh budget:
 * resetting would let one task consume attempt budget indefinitely, one repair
 * at a time, which is the ping-pong the bound exists to prevent. `repairsUsed`
 * caps how many repairs a single task may receive at all.
 */
export async function grantRepairRetry(root, revision, taskId, { maxRepairs = 1 } = {}) {
  return transaction(root, revision, state => {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task) throw new Error('repair retry names no task in this run');
    if (task.status !== 'blocked') throw new Error('only a blocked task can be returned to the worker');
    if (task.repairsUsed >= maxRepairs) throw new Error(`task ${taskId} has already used its ${maxRepairs} repair(s)`);
    task.repairsUsed += 1;
    task.status = 'queued';
    task.stage = 'queued';
    task.commit = null;
    task.evidence = null;
    task.blocker = null;
    task.attempts = Math.max(0, state.maxAttempts - 1);
    state.status = state.pauseRequested ? 'paused' : 'ready';
    event(state, 'repair_retry_granted', `${taskId}: one further attempt after reviewer repair`,
      { taskId, actor: 'controller', repairsUsed: task.repairsUsed });
  });
}

export async function acceptProjectFinalReview(root, revision, { reviewer = 'unknown', summary = '' } = {}) {
  return transaction(root, revision, state => {
    if (!Number.isSafeInteger(revision) || state.activeTask || !state.tasks.every(task => task.status === 'accepted')) throw new Error('final review not ready');
    if (state.escalation) throw new Error('resolve the escalation before closing the run');
    if (state.steering.some(item => !item.applied)) throw new Error('pending steering requires review before completion');
    state.finalReview = true;
    state.status = 'completed';
    event(state, 'final_review', `Combined implementation accepted by ${String(reviewer).slice(0, 120)}. ${String(summary).slice(0, 500)}`, { actor: 'reviewer' });
  });
}

export function projectAgentProgress(state) {
  const total = state.tasks.reduce((sum, task) => sum + task.weight, 0);
  const accepted = state.tasks.filter(task => task.status === 'accepted').reduce((sum, task) => sum + task.weight, 0);
  const planned = state.tasks.filter(task => task.origin === 'plan').reduce((sum, task) => sum + task.weight, 0);
  return {
    acceptedTasks: state.tasks.filter(task => task.status === 'accepted').length,
    blockedTasks: state.tasks.filter(task => task.status === 'blocked').length,
    totalTasks: state.tasks.length,
    correctionTasks: state.tasks.filter(task => task.origin !== 'plan').length,
    // Capped at 99 until final review so "done" is something a reviewer says,
    // never something arithmetic says. The denominator GROWS when a review adds
    // corrections, so this percentage can go down -- that is honest, and the UI
    // shows `correctionTasks` beside it so a fall has a visible cause.
    percent: state.finalReview ? 100 : Math.min(99, Math.floor(100 * accepted / total)),
    scopeGrowth: total > planned ? Number(((total - planned) / planned).toFixed(3)) : 0,
  };
}

/**
 * Execute at most one task, then stop at the review gate.
 *
 * Deliberately still one task per invocation. The continuous loop is the
 * supervisor's job (`scripts/lib/agentic/supervisor.mjs`), which calls this,
 * then calls the reviewer, then calls this again -- so every task boundary is
 * also a process boundary where a crash costs one task, not a night.
 */
export async function runProjectAgent(root, { worker, verify, durationMs, taskTimeoutMs = 60000 } = {}) {
  if (typeof worker !== 'function' || typeof verify !== 'function' || !Number.isSafeInteger(durationMs) || durationMs < 1 ||
      durationMs > 12 * 3600000 || !Number.isSafeInteger(taskTimeoutMs) || taskTimeoutMs < 1) throw new Error('bounded host adapters required');
  const lease = join(root, 'worker.lock');
  await mkdir(lease, { mode: 0o700 });
  let uncertain = false;
  const started = performance.now();
  try {
    let task, instructions;
    const claimed = await transaction(root, undefined, state => {
      if (state.activeTask) { state.status = 'interrupted'; throw new Error('unfinished operation needs reconciliation'); }
      if (['completed', 'interrupted', 'escalated'].includes(state.status)) return;
      if (state.pauseRequested) { state.status = 'paused'; return; }
      if (state.tasks.some(item => item.status === 'awaiting_review') || state.tasks.every(item => item.status === 'accepted')) {
        state.status = 'waiting_for_review'; return;
      }
      const accepted = new Set(state.tasks.filter(item => item.status === 'accepted').map(item => item.id));
      const claimable = state.tasks.filter(item => item.status === 'queued' && item.attempts < state.maxAttempts &&
        item.dependencies.every(id => accepted.has(id)));
      // Corrections first. A review found something wrong with work that was
      // just accepted; letting NEW planned work start on top of it means the
      // next task builds on the thing being corrected, and the correction then
      // has to be applied twice. Within each group, plan order is preserved.
      task = claimable.find(item => item.origin !== 'plan') ?? claimable[0];
      if (!task) { state.status = 'waiting_for_review'; return; }
      instructions = state.steering.filter(item => !item.applied).map(item => ({ ...item }));
      for (const item of state.steering) item.applied = true;
      task.status = 'running'; task.stage = 'inspect'; task.attempts++;
      state.status = 'running'; state.activeTask = task.id;
      event(state, 'task_started', task.title, { taskId: task.id, actor: 'worker', attempt: task.attempts });
      task = clone(task);
    });
    if (!task) return claimed;

    const controller = new AbortController();
    let timer, result;
    const timeout = Math.max(1, Math.min(taskTimeoutMs, durationMs - (performance.now() - started)));
    try {
      result = await Promise.race([
        (async () => {
          const candidate = await worker(clone(task), { signal: controller.signal, instructions: clone(instructions), root });
          // Checked BEFORE verify: a worker that resolves after the timeout must
          // not be able to start host verification and publish a late success.
          if (controller.signal.aborted) throw new Error('cancelled worker');
          if (!candidate || !isSha(candidate.commit) || await verify(clone(task), clone(candidate), controller.signal) !== true) throw new Error('acceptance not verified');
          return candidate;
        })(),
        new Promise((_, reject) => { timer = setTimeout(() => { uncertain = true; controller.abort(); reject(new Error('timeout')); }, timeout); }),
      ]);
    } catch (error) {
      await transaction(root, undefined, state => {
        const current = state.tasks.find(item => item.id === task.id);
        current.status = 'blocked';
        current.evidence = null;
        current.blocker = uncertain ? 'worker_outcome_unknown' : 'worker_or_validation_failed';
        state.activeTask = null;
        state.status = uncertain ? 'interrupted' : state.pauseRequested ? 'paused' : 'waiting_for_review';
        event(state, 'blocked', `${task.id}: ${current.blocker}`, { taskId: task.id, actor: 'worker', error: String(error?.message ?? error) });
      });
      return await readProjectAgent(root);
    } finally { clearTimeout(timer); }

    return await transaction(root, undefined, state => {
      const current = state.tasks.find(item => item.id === task.id);
      current.commit = result.commit; current.status = 'awaiting_review'; current.stage = 'review';
      // The reviewer must judge on evidence, not on impressions. Carrying the
      // worker's own account and the check results in durable state means the
      // review sees exactly what the run recorded, and survives a crash between
      // the checkpoint and the review.
      current.evidence = {
        summary: String(result.summary ?? '').slice(0, 2000),
        files: (result.files ?? []).map(file => String(file).slice(0, 300)).slice(0, 60),
        checks: (result.checks ?? []).map(check => ({ name: String(check.name), ok: Boolean(check.ok),
          ms: Number.isFinite(check.ms) ? check.ms : null, exitCode: check.exitCode ?? null })).slice(0, 20),
      };
      state.activeTask = null;
      state.status = state.pauseRequested ? 'paused' : 'waiting_for_review';
      event(state, 'review_requested', `${task.id}: verified checkpoint awaits independent review.`,
        { taskId: task.id, actor: 'worker', commit: result.commit, files: result.files ?? [], checks: result.checks ?? [] });
    });
  } finally {
    // Unknown worker lifetime retains the lease. Never start a second writer
    // merely because a timeout was observed; `agentic/lease.mjs` reconciles it
    // only on PROOF that the holder is dead.
    if (!uncertain) await rmdir(lease).catch(() => {});
  }
}
