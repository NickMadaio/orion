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
import { mkdir, open, readFile, rename, rmdir, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { contractDigest, normalizeTaskContract, normalizeTaskGraph } from './agentic/contract.mjs';
import { acquireLease, releaseLease } from './agentic/lease.mjs';
import { appendJournal } from './agentic/journal.mjs';

export const RUN_STATES = ['ready', 'running', 'paused', 'waiting_for_review', 'interrupted', 'budget_exhausted', 'escalated', 'completed'];
export const TASK_STATES = ['queued', 'running', 'awaiting_review', 'accepted', 'blocked'];
export const STAGES = ['queued', 'inspect', 'implement', 'test', 'review', 'repair', 'accepted'];
export const DECISIONS = ['accept', 'accept_with_tasks', 'changes_requested', 'blocked'];
/*
 How loudly the run may reach Nick. `quiet` is for when he is asleep: a task
 the local loop gives up on is deferred to the Astra list without a message,
 and the only thing sent is one silent digest when the run stops. `away` is for
 when he is out: each deferral is sent as it happens. Either way a deferred task
 no longer stops the independent work behind it.
*/
export const ALERT_MODES = ['quiet', 'away'];

const clone = value => structuredClone(value);
const stamp = () => new Date().toISOString();
const isSha = value => typeof value === 'string' && /^[a-f0-9]{40}$/.test(value);

/** Escalations still waiting on a human. */
const openEscalations = state => state.escalations.filter(item => !item.resolvedAt);

/**
 * Tasks the loop may still pick up.
 *
 * A task under an open escalation is excluded, and so is anything depending on
 * a task that is not accepted. Everything else remains fair game -- which is
 * the whole point of task-level escalation: one hard problem parks ONE task,
 * and the night continues on the rest.
 */
export function claimableTasks(state) {
  const accepted = new Set(state.tasks.filter(item => item.status === 'accepted').map(item => item.id));
  const parked = new Set(openEscalations(state).map(item => item.taskId).filter(Boolean));
  return state.tasks.filter(item => item.status === 'queued' && item.attempts < state.maxAttempts &&
    !parked.has(item.id) && item.dependencies.every(id => accepted.has(id)));
}

/**
 * What the loop can do next, given the escalations that are open.
 *
 * `escalated` now means "stopped because nothing else can be done", NOT "an
 * escalation exists". A run-level escalation (taskId null) stops everything; a
 * task-level one only stops the run once no claimable work is left.
 */
function settleStatus(state) {
  if (state.finalReview) return 'completed';
  if (state.activeTask) return 'running';
  if (state.pauseRequested) return 'paused';
  const open = openEscalations(state);
  if (open.some(item => item.taskId === null)) return 'escalated';
  if (state.tasks.some(item => item.status === 'awaiting_review')) return 'waiting_for_review';
  if (claimableTasks(state).length) return 'ready';
  // `escalated` requires an actual escalation record. A run where every task is
  // merely blocked has not escalated yet -- the supervisor raises one on its
  // next pass, and until then the honest status is "the loop cannot proceed",
  // which is what waiting_for_review has always meant here.
  if (open.length) return 'escalated';
  return 'waiting_for_review';
}

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
  if (state.version !== 3) fail('unsupported schema version');
  if (!Number.isSafeInteger(state.revision) || state.revision < 0) fail('revision');
  if (!Number.isSafeInteger(state.journalSeq) || state.journalSeq < 0) fail('journalSeq');
  if (typeof state.runId !== 'string' || !state.runId) fail('runId');
  if (typeof state.finalReview !== 'boolean' || typeof state.pauseRequested !== 'boolean') fail('flags');
  // Older runs predate these, and a missing stop flag must read as "not asked
  // to stop" rather than blanking a run that is otherwise perfectly readable.
  state.stopRequested = state.stopRequested === true;
  state.exterminateRequested = state.exterminateRequested === true;
  state.exterminateToken ??= null;
  if (state.exterminateToken !== null && (typeof state.exterminateToken !== 'string' || !state.exterminateToken)) fail('exterminateToken');
  if (!state.exterminateRequested) state.exterminateToken = null;
  // Runs from before alert modes read as quiet: that is the mode they were
  // missing, and the one that cannot wake anybody.
  if (!ALERT_MODES.includes(state.alertMode)) state.alertMode = 'quiet';
  if (!Number.isInteger(state.maxAttempts) || state.maxAttempts < 1 || state.maxAttempts > 10) fail('maxAttempts must be 1-10');
  if (!Number.isInteger(state.maxCorrectionDepth) || state.maxCorrectionDepth < 0 || state.maxCorrectionDepth > 3) fail('maxCorrectionDepth must be 0-3');
  if (!RUN_STATES.includes(state.status)) fail('status');
  for (const field of ['tasks', 'events', 'steering', 'reviews', 'repairs', 'escalations']) {
    if (!Array.isArray(state[field])) fail(field);
  }
}

export async function readProjectAgent(root) {
  const state = JSON.parse(await readFile(join(root, 'state.json'), 'utf8'));
  return validateProjectAgent(state);
}

function validateProjectAgent(state) {
  validateRuntimeFields(state);
  if (state.runtimeRecoveries !== undefined && (!Array.isArray(state.runtimeRecoveries) ||
      state.runtimeRecoveries.length > 20 || state.runtimeRecoveries.some(r =>
        !r || typeof r.id !== 'string' || typeof r.key !== 'string' ||
        !['started', 'failed', 'retry_authorized', 'escalate'].includes(r.outcome)))) {
    throw new Error('invalid runtime recovery history');
  }
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
    // Why the task was last sent back to the worker, shown in its next prompt.
    // Optional because tasks written before it existed carry none.
    if (task.feedback !== undefined && task.feedback !== null &&
        (typeof task.feedback !== 'string' || task.feedback.length > 2000)) bad('feedback');
    if (task.reviewFailures !== undefined &&
        (!Number.isInteger(task.reviewFailures) || task.reviewFailures < 0 || task.reviewFailures > 10)) bad('reviewFailures');
    if (task.repairCheckpoint !== undefined && task.repairCheckpoint !== null) {
      if (typeof task.repairCheckpoint !== 'object' || !isSha(task.repairCheckpoint.commit) ||
          !Array.isArray(task.repairCheckpoint.files) || !task.repairCheckpoint.files.length ||
          task.repairCheckpoint.files.some(path => typeof path !== 'string' || !path)) bad('repairCheckpoint');
    }
    if (task.origin !== 'plan' && task.correctionDepth < 1) bad('a review-authored task must record its correction depth');
    // The mission asks the RUNTIME to own "current subtask" rather than a model
    // remembering it. It is the worker's own declaration, recorded durably, so
    // a crash or a UI refresh does not lose where the work had got to.
    if (task.subtask !== null) {
      if (typeof task.subtask !== 'object' || typeof task.subtask.label !== 'string' || !task.subtask.label.trim() ||
          !Number.isInteger(task.subtask.index) || task.subtask.index < 1 ||
          !Number.isInteger(task.subtask.total) || task.subtask.total < task.subtask.index ||
          task.subtask.total > 40) bad('subtask');
    }
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
  // `escalated` must mean the loop is genuinely stuck, not merely that an
  // escalation exists somewhere. Otherwise one parked task would stop a night
  // of work that could have continued.
  if (state.status === 'escalated' && !openEscalations(state).length) fail('escalated with no open escalation');
  if (state.status === 'ready' && !claimableTasks(state).length) fail('ready with nothing claimable');

  for (const escalation of state.escalations) {
    if (typeof escalation.id !== 'string' || !escalation.id || typeof escalation.reason !== 'string' || !escalation.reason ||
        typeof escalation.kind !== 'string' || typeof escalation.notified !== 'boolean' ||
        (escalation.taskId !== null && !state.tasks.some(task => task.id === escalation.taskId))) fail('escalation record');
  }
  if (new Set(state.escalations.map(item => item.id)).size !== state.escalations.length) fail('duplicate escalation id');
  for (const item of state.steering) {
    if (typeof item.id !== 'string' || typeof item.text !== 'string' || typeof item.applied !== 'boolean') fail('steering');
  }
  for (const item of state.events) {
    if (typeof item.kind !== 'string' || typeof item.message !== 'string' || !Number.isFinite(Date.parse(item.at))) fail('event');
  }
  for (const item of state.reviews) {
    // A RUN-level review — the final review of the whole body of work — names
    // no task and no commit, and says so with nulls rather than by pointing at
    // something that does not exist. Per-TASK reviews keep the strict rule:
    // they must name a real task and a real checkpoint.
    const runLevel = item.taskId === null && item.commit === null;
    if (!runLevel && (!state.tasks.some(task => task.id === item.taskId) || !isSha(item.commit))) fail('review');
    if (!DECISIONS.includes(item.decision) ||
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
/*
 Take the state lock, waiting briefly rather than failing on contention.

 `mkdir` is the atomic primitive and stays the primitive. What changed is what
 happens when it is already held: this used to throw immediately, which meant an
 operator control landing in the same millisecond as a controller commit could
 knock the SUPERVISOR's transaction over. Found by a test of EXTERMINATE, where
 the cost was exact and ugly — the write recording that the task had stopped was
 the one that got lost, leaving a task marked `running` that nothing was
 running. A human pressing a button must never be able to do that.

 A transaction holds this for milliseconds, so waiting up to two seconds covers
 any real contention and still refuses to wait forever. A lock older than a
 minute cannot belong to a live transaction; it is the debris of a crash between
 `mkdir` and `rmdir`, and reclaiming it is the difference between a run that
 recovers and a run that is bricked until someone finds the directory by hand.
*/
const LOCK_WAIT_MS = 2_000;
const LOCK_STALE_MS = 60_000;

async function acquireStateLock(lock) {
  const deadline = Date.now() + LOCK_WAIT_MS;
  for (;;) {
    try {
      await mkdir(lock, { mode: 0o700 });
      return;
    } catch (error) {
      if (error.code !== 'EEXIST') throw error;
      const age = await stat(lock).then(info => Date.now() - info.mtimeMs, () => 0);
      if (age > LOCK_STALE_MS) {
        await rmdir(lock).catch(() => {});
        continue;
      }
      if (Date.now() >= deadline) {
        throw new Error(`the controller state lock at ${lock} was held for longer than ${LOCK_WAIT_MS}ms`);
      }
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
}

async function transaction(root, expected, update) {
  const lock = join(root, 'state.lock');
  await acquireStateLock(lock);
  try {
    const state = await readProjectAgent(root);
    if (expected !== undefined && state.revision !== expected) throw new Error('state revision changed; refresh first');
    await update(state);
    state.revision++;
    // Reject invalid host updates before replacing the last readable snapshot.
    validateProjectAgent(state);
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
    version: 3, revision: 0, runId: randomUUID(), status: 'ready', activeTask: null,
    pauseRequested: false, stopRequested: false, exterminateRequested: false, exterminateToken: null,
    alertMode: 'quiet', maxAttempts, maxCorrectionDepth, finalReview: false, journalSeq: 0,
    escalations: [], steering: [], reviews: [], repairs: [], events: [],
    tasks: contracts.map(contract => ({ ...clone(contract), status: 'queued', stage: 'queued', attempts: 0, corrections: 0, correctionDepth: 0, repairsUsed: 0, commit: null, blocker: null, evidence: null, subtask: null })),
  };
  event(state, 'initialized', `Approved task graph loaded: ${contracts.length} task(s). Execution adapters are not enabled by initialization.`,
    { actor: 'operator', tasks: contracts.map(contract => ({ id: contract.id, digest: contractDigest(contract) })) });
  await publish(root, state, true);
  for (const record of pending(state)) await appendJournal(root, { ...record, revision: 0 }).catch(() => {});
  state._pending = [];
  return state;
}

export async function steerProjectAgent(root, command, revision, text) {
  const revisionFree = ['pause', 'resume', 'stop', 'exterminate', 'alerts'].includes(command) && revision === undefined;
  if (!revisionFree && !Number.isSafeInteger(revision)) throw new Error('revision required');
  return transaction(root, revision, state => {
    if (state.status === 'completed') throw new Error('run completed');
    if (command === 'pause') {
      state.pauseRequested = true;
      if (!state.activeTask && state.status !== 'escalated') state.status = 'paused';
      event(state, 'pause', state.activeTask ? 'Pause requested; waiting for task boundary.' : 'Paused.', { actor: 'operator' });
    } else if (command === 'resume') {
      if (state.status === 'escalated') throw new Error('resolve the escalation before resuming');
      /*
       Resume clears the operator's REQUESTS; it never reconciles work.

       It used to refuse outright on an interrupted run. Combined with `run`
       refusing while a stop stands, that made an interrupted-and-stopped run —
       exactly what an exterminate mid-task produced — impossible to restart
       from anywhere: resume needed reconciliation, reconciliation needed a
       running supervisor, and the supervisor needed the stop cleared.

       Clearing a flag is always safe. What must not happen is a second writer
       starting beside a first that may still be alive, and that is guarded
       where it belongs: recovery reconciles an interrupted run only on PROOF
       that the lease holder is dead. So an interrupted run stays interrupted
       here, and a task still in flight keeps running; only the requests go.
      */
      state.pauseRequested = false;
      state.stopRequested = false;
      state.exterminateRequested = false;
      state.exterminateToken = null;
      if (state.status !== 'interrupted' && !state.activeTask) state.status = settleStatus(state);
      event(state, 'resume', state.status === 'interrupted'
        ? 'Resume requested; the interrupted task will be reconciled when a supervisor next starts.'
        : 'Resume requested; review gates remain enforced.', { actor: 'operator' });
    } else if (command === 'stop') {
      /*
       STOP: finish somewhere safe, then end the run.

       The loop claims no further work and exits at the next task boundary,
       where state is published, the tree is clean and the lease is released —
       so the run can be picked straight back up. The task in flight is allowed
       to finish; interrupting a model mid-generation is what EXTERMINATE is for.
      */
      state.stopRequested = true;
      event(state, 'stop', state.activeTask
        ? 'Stop requested; the loop will end after the task in flight reaches a safe boundary.'
        : 'Stop requested; the loop will end at the next boundary.', { actor: 'operator' });
    } else if (command === 'exterminate') {
      /*
       EXTERMINATE: stop NOW, and accept the cost.

       The in-flight generation is aborted rather than awaited. The task's
       outcome is therefore unknown, which is a state this controller already
       models: the lease is retained, the run reconciles on next start, and any
       half-written mutation is discarded back to the last accepted commit. It
       is abrupt, not destructive — nothing accepted is ever lost, because the
       only thing this system treats as real is a committed checkpoint.
      */
      state.exterminateRequested = true;
      state.exterminateToken = randomUUID();
      state.stopRequested = true;
      event(state, 'exterminate', 'Immediate stop requested; the in-flight model call will be abandoned.', { actor: 'operator' });
    } else if (command === 'alerts') {
      // A preference, not a control: it changes who is told, never what runs,
      // so it needs no revision and applies at the loop's next notification.
      if (!ALERT_MODES.includes(text)) throw new Error(`alert mode must be one of ${ALERT_MODES.join(', ')}`);
      state.alertMode = text;
      event(state, 'alert_mode', text === 'quiet'
        ? 'Quiet: deferrals are held for one silent digest when the run stops.'
        : 'Away: each deferral is sent as it happens.', { actor: 'operator' });
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
/**
 * Raise an escalation.
 *
 * `taskId` set  -> TASK-LEVEL. That task is parked and the loop carries on with
 *                  everything else. This is the normal case: one contract turned
 *                  out to be ambiguous; the other nine are unaffected.
 * `taskId` null -> RUN-LEVEL. Something is wrong with the run as a whole and
 *                  nothing may proceed.
 *
 * Nothing inside the loop may resolve either. That asymmetry is the point: the
 * system that decided it needs a human must not also decide it no longer does.
 */
export async function escalateProjectAgent(root, revision, { kind, reason, taskId = null, question = null, recommendAstra = false, detail = {} }) {
  return transaction(root, revision, state => {
    if (state.status === 'completed') throw new Error('run completed');
    if (typeof kind !== 'string' || !kind.trim() || typeof reason !== 'string' || !reason.trim()) throw new Error('escalation needs a kind and a reason');
    if (taskId !== null && !state.tasks.some(task => task.id === taskId)) throw new Error('escalation names no task in this run');
    if (state.activeTask) throw new Error('escalate at a task boundary, not mid-task');
    // One open escalation per task; a second for the same task would alert twice
    // for one problem.
    if (openEscalations(state).some(item => item.taskId === taskId)) return;

    state.escalations.push({ id: randomUUID(), at: stamp(), kind: kind.trim().slice(0, 64),
      reason: reason.trim().slice(0, 2000), taskId,
      question: question ? String(question).slice(0, 1000) : null,
      recommendAstra: Boolean(recommendAstra), notified: false, notifiedAt: null, resolvedAt: null, note: null,
      // Every task-level escalation is a deferral: the task waits for Astra and
      // everything that does not depend on it carries on. Only a run-level
      // escalation is a stop.
      deferred: taskId !== null });

    if (taskId) {
      const task = state.tasks.find(item => item.id === taskId);
      // A task that HAS run is blocked; one escalated before it ever ran stays
      // queued and is parked by `claimableTasks` instead. Marking the latter
      // `blocked` would mean a blocked task with zero attempts, which the
      // lifecycle validator correctly refuses.
      if (task.status !== 'accepted' && task.attempts > 0) {
        task.status = 'blocked';
        task.stage = 'queued';
        task.commit = null;
        task.evidence = null;
        task.blocker = task.blocker ?? `escalated: ${kind}`;
      }
    }
    state.status = settleStatus(state);
    event(state, 'escalated', `${taskId ? `${taskId}: ` : 'run: '}${kind}: ${reason}`,
      { taskId, detail, actor: 'controller', scope: taskId ? 'task' : 'run', remaining: claimableTasks(state).length });
  });
}

export async function markEscalationNotified(root, revision, escalationId) {
  return transaction(root, revision, state => {
    const escalation = state.escalations.find(item => item.id === escalationId);
    if (!escalation) throw new Error('no such escalation');
    escalation.notified = true;
    escalation.notifiedAt = stamp();
    event(state, 'escalation_notified', `Owner alerted about ${escalation.taskId ?? 'the run'}.`, { actor: 'controller', escalationId });
  });
}

/**
 * Clear one escalation. Operator-only.
 *
 * `requeue` returns the parked task to the queue with its attempts reset to one
 * below the limit -- the same single-further-attempt rule a reviewer repair
 * gets, so resolving an escalation cannot silently refill a task's budget.
 */
export async function resolveProjectEscalation(root, revision, escalationId, note, { requeue = true } = {}) {
  return transaction(root, revision, state => {
    const escalation = state.escalations.find(item => item.id === escalationId && !item.resolvedAt);
    if (!escalation) throw new Error('no such open escalation');
    escalation.resolvedAt = stamp();
    escalation.note = String(note ?? '').slice(0, 1000) || null;

    if (escalation.taskId && requeue) {
      const task = state.tasks.find(item => item.id === escalation.taskId);
      if (task && task.status === 'blocked') {
        task.status = 'queued';
        task.stage = 'queued';
        task.blocker = null;
        task.commit = null;
        task.evidence = null;
        // The escalation exists because the reviewer rejected the previous
        // candidate. Keeping its repair checkpoint made the next launch
        // deterministically resubmit the same rejected commit, so Continue
        // appeared to start and immediately stopped again. A human resolution
        // grants one real worker attempt from that commit, with the resolution
        // note as the reason it came back.
        task.repairCheckpoint = null;
        task.feedback = String(note ?? 'The escalation was resolved; address the recorded finding.').slice(0, 2000);
        task.attempts = Math.min(task.attempts, Math.max(0, state.maxAttempts - 1));
      }
    }
    state.status = settleStatus(state);
    event(state, 'escalation_resolved', `${escalation.kind} resolved: ${String(note ?? 'no note').slice(0, 500)}`,
      { actor: 'operator', escalationId, taskId: escalation.taskId });
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
    if (state.status !== 'interrupted' && !(state.status === 'running' && state.activeTask)) throw new Error('the run is not interrupted');
    if (!deadOwnerProof || deadOwnerProof.dead !== true || typeof deadOwnerProof.reason !== 'string' || !deadOwnerProof.reason) {
      throw new Error('reconciliation requires proof that the worker lease holder is dead');
    }
    if (state.activeTask) {
      const task = state.tasks.find(item => item.id === state.activeTask);
      task.status = 'blocked';
      task.stage = 'queued';
      task.commit = null;
      task.evidence = null;
      task.subtask = null;
      task.blocker = 'worker_outcome_unknown';
      state.activeTask = null;
    }
    state.status = settleStatus(state);
    event(state, 'reconciled', `Interrupted run reconciled: ${deadOwnerProof.reason}`,
      { actor: 'supervisor', proof: deadOwnerProof });
  });
}

/**
 * The scope a HUMAN approved for this run: the union of the plan's task scopes.
 *
 * Correction tasks from a final review inherit this. Nothing is invented and no
 * reviewer grants itself reach, because every path in the union was written by a
 * person into the plan — while a correction naming anything outside it is the
 * case that genuinely needs a human, and escalates.
 */
export function runScope(state) {
  return [...new Set(state.tasks.filter(item => item.origin === 'plan').flatMap(item => item.scope))];
}

/*
 The brief a correction works from. A correction is follow-up work on its
 parent's files, so it needs the parent's reference material as much as the
 parent did. It is never the reviewer's to write: a review that could attach
 its own brief could hand the worker instructions no person read.

 A final-review correction has no single parent, so it takes the brief of the
 latest planned task whose scope covers every file it may touch — or, failing
 that, the one that covers most of them.
*/
function inheritedBrief(state, task, scope) {
  if (task.id !== 'final') return task.brief ?? '';
  const covers = (allowed, entry) => (allowed.endsWith('/') ? entry.startsWith(allowed) : entry === allowed);
  const planned = state.tasks.filter(item => item.origin === 'plan' && item.brief);
  let best = null, bestCount = 0;
  for (const item of planned) {
    const count = scope.filter(entry => item.scope.some(allowed => covers(allowed, entry))).length;
    if (count >= bestCount && count > 0) { best = item; bestCount = count; }
  }
  return best?.brief ?? '';
}

function appendCorrections(state, task, corrections, reviewId, { dependencies = [task.id] } = {}) {
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
      brief: inheritedBrief(state, task, narrowed),
      checks: Array.isArray(raw.checks) && raw.checks.length ? raw.checks : task.checks,
      weight: Number.isInteger(raw.weight) ? Math.min(raw.weight, task.weight) : 1,
      dependencies,
      risk: raw.risk ?? task.risk,
      origin: 'review_correction',
      originReview: reviewId,
    });
    existing.add(id);
    added.push({ ...clone(contract), status: 'queued', stage: 'queued', attempts: 0, corrections: 0, correctionDepth: depth, repairsUsed: 0, commit: null, blocker: null, evidence: null, subtask: null });
  }
  return added;
}

/**
 * Record where the worker says it has got to inside a task.
 *
 * Deliberately durable rather than kept in the activity channel: the mission is
 * explicit that the runtime owns "current subtask", and a model that has to
 * remember its own position has been handed the runtime's job. A handful of
 * writes per task is a cost worth paying for a panel that survives a refresh
 * and a crash that does not lose the thread.
 *
 * The worker DECLARES this; nothing verifies it. It is a progress label, and it
 * is never allowed to influence acceptance -- `stage` and the checks decide
 * that. A model that claims "3 of 3, done" has still not passed its checks.
 */
/** Requeue only a known ordinary failure, within the original attempt budget. */
/**
 * Count a failed attempt to REVIEW a checkpoint. Returns the new state; the
 * caller reads `reviewFailures` to decide whether to try again or hand back.
 */
export async function recordReviewFailure(root, revision, taskId, reason) {
  return transaction(root, revision, state => {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task || task.status !== 'awaiting_review') throw new Error('only a checkpoint awaiting review can fail review');
    task.reviewFailures = Math.min(10, (task.reviewFailures ?? 0) + 1);
    event(state, 'review_failed', `${taskId}: the review could not be completed (${task.reviewFailures})`,
      { taskId, actor: 'reviewer', reason: String(reason ?? '').slice(0, 500) });
  });
}

/**
 * Withdraw a checkpoint and give the task back to the worker, with the reason.
 *
 * This is the rung for a REVIEWER that could not do its job — it could not
 * produce a usable review, or the checks it re-ran disagreed with the worker's.
 * The worker cannot approve its own work, so it cannot stand in for the
 * reviewer; what it can do is produce a new checkpoint the reviewer can judge,
 * told exactly why the last one came back. The withdrawn commit becomes
 * unknown, so the supervisor's reset removes it and the retry is reviewed as a
 * whole rather than as a patch on top of work no review accepted.
 *
 * Bounded by the attempt budget like any other retry. Out of attempts, the task
 * is blocked as `review_unavailable`, which is Nick's: the reviewer is the rung
 * that failed, so it cannot also be the rung that repairs.
 */
export async function returnTaskToWorker(root, revision, taskId, { feedback } = {}) {
  return transaction(root, revision, state => {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task || task.status !== 'awaiting_review') throw new Error('only a checkpoint awaiting review can be returned');
    const again = task.attempts < state.maxAttempts;
    task.status = again ? 'queued' : 'blocked';
    task.stage = 'queued';
    task.blocker = again ? null : 'review_unavailable';
    task.commit = null;
    task.evidence = null;
    task.subtask = null;
    task.reviewFailures = 0;
    task.feedback = String(feedback ?? 'The reviewer returned this task.').slice(0, 2000);
    state.status = settleStatus(state);
    event(state, 'returned_to_worker', `${taskId}: checkpoint withdrawn and ${again ? 'returned to the worker' : 'blocked — no attempts left'}`,
      { taskId, actor: 'reviewer', feedback: task.feedback });
  });
}

export async function retryFailedProjectTask(root, revision, taskId) {
  return transaction(root, revision, state => {
    const task = state.tasks.find(item => item.id === taskId);
    if (state.stopRequested || state.pauseRequested || state.exterminateRequested) throw new Error('run is stopped or paused');
    if (!task || task.status !== 'blocked' || task.blocker !== 'worker_or_validation_failed' || task.attempts >= state.maxAttempts ||
        openEscalations(state).some(item => item.taskId === null || item.taskId === taskId)) {
      throw new Error('task is not eligible for an automatic retry');
    }
    task.status = 'queued'; task.stage = 'queued'; task.blocker = null;
    task.commit = null; task.evidence = null; task.subtask = null;
    state.status = settleStatus(state);
    event(state, 'worker_retry_queued', `${task.id}: retry after ${task.attempts} failed attempt(s)`, { taskId, actor: 'controller' });
  });
}

export async function setTaskSubtask(root, taskId, { label, index, total }) {
  return transaction(root, undefined, state => {
    const task = state.tasks.find(item => item.id === taskId);
    if (!task || task.status !== 'running') return;
    const clean = String(label ?? '').trim().slice(0, 200);
    if (!clean) return;
    const count = Math.min(40, Math.max(1, Number.isInteger(total) ? total : 1));
    task.subtask = { label: clean, index: Math.min(count, Math.max(1, Number.isInteger(index) ? index : 1)), total: count, at: stamp() };
    event(state, 'subtask', `${taskId}: ${task.subtask.index}/${count} ${clean}`,
      { taskId, actor: 'worker', subtask: task.subtask });
  });
}

/**
 * The review gate. Only a trusted reviewer adapter calls this; the worker is
 * never handed it and cannot accept its own work.
 */
export async function reviewProjectTask(root, { revision, taskId, commit, decision, review = {} }) {
  if (!Number.isSafeInteger(revision)) throw new Error('review revision required');
  return transaction(root, revision, state => {
    if (state.exterminateRequested) throw new Error('run exterminated; review publication refused');
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
      task.status = 'accepted'; task.stage = 'accepted'; task.blocker = null; task.evidence = null; task.subtask = null;
      task.feedback = null; task.reviewFailures = 0;
    } else if (decision === 'changes_requested') {
      task.corrections += 1;
      // The worker used to retry without ever seeing what the reviewer found.
      const findings = (review.failed ?? []).map(item => `[${item.severity}] ${item.criterion}`).join('; ');
      task.feedback = `The reviewer requested changes: ${String(review.summary ?? '').slice(0, 600)}${findings ? ` — ${findings.slice(0, 1200)}` : ''}`;
      const exhausted = task.attempts >= state.maxAttempts;
      task.status = exhausted ? 'blocked' : 'queued';
      task.stage = 'queued';
      task.commit = null;
      task.evidence = null;
      task.blocker = exhausted ? 'repair_budget_exhausted' : null;
    } else {
      task.status = 'blocked'; task.stage = 'queued'; task.commit = null; task.evidence = null; task.subtask = null;
      task.blocker = review.escalationReason ? `review_blocked: ${String(review.escalationReason).slice(0, 300)}` : 'review_blocked';
    }

    // A reviewed checkpoint is consumed, whatever the verdict. A repair
    // checkpoint that survived a "changes requested" was resubmitted, unchanged,
    // on every later attempt -- the worker never got a turn, and the attempts
    // ran out on a commit the reviewer had already answered.
    task.repairCheckpoint = null;
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
    state.status = settleStatus(state);
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
/*
 Replace the briefs of tasks that have not been done yet, on a run that has
 already started.

 A brief is reference material, but it is part of the contract's identity
 (contract.mjs), so this is a contract revision: `rev` goes up, and the journal
 says who changed what. Only tasks still waiting (queued or blocked) change --
 accepted work was reviewed against the brief it had, and a task in flight is
 being judged against its current one. A correction inherits its parent's new
 brief, exactly as it inherited the old one.

 The caller (projects.mjs rebriefProject) proves the task blocks themselves are
 unchanged; this function only ever touches `brief` and `rev`.
*/
export async function refreshRunBriefs(root, revision, { briefs, reason = 'briefs refreshed by the operator' } = {}) {
  if (!briefs || typeof briefs !== 'object') throw new Error('refreshRunBriefs needs a map of task id to brief');
  return transaction(root, revision, state => {
    if (state.exterminateRequested) throw new Error('run exterminated; brief refresh refused');
    if (state.activeTask) throw new Error('a task is in flight; refresh briefs at a boundary');
    const changed = [], untouched = [];
    const waiting = task => task.status === 'queued' || task.status === 'blocked';
    for (const task of state.tasks) {
      const parent = task.origin === 'review_correction' ? state.tasks.find(item => task.id.startsWith(`${item.id}-fix`) && item.origin === 'plan') : null;
      const source = task.origin === 'plan' ? task.id : parent?.id;
      if (!source || !Object.hasOwn(briefs, source)) continue;
      const brief = normalizeTaskContract({ ...task, brief: briefs[source] }).brief;
      if (brief === (task.brief ?? '')) continue;
      if (!waiting(task)) { untouched.push({ id: task.id, status: task.status }); continue; }
      task.brief = brief;
      task.rev = (task.rev ?? 1) + 1;
      changed.push({ id: task.id, rev: task.rev, chars: brief.length });
    }
    event(state, 'briefs_refreshed', `${changed.length} task brief(s) replaced: ${changed.map(item => item.id).join(', ') || 'none'}`,
      { actor: 'operator', reason: String(reason).slice(0, 300), changed, untouched });
  });
}

export async function grantRepairRetry(root, revision, taskId, {
  maxRepairs = 1, retryAttempts = 1, feedback = null, checkpoint = null,
} = {}) {
  return transaction(root, revision, state => {
    if (state.exterminateRequested) throw new Error('run exterminated; repair continuation refused');
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
    // `retryAttempts` further attempts, never a fresh budget: resetting to zero
    // is what would let one task consume the run one repair at a time.
    task.attempts = Math.max(0, state.maxAttempts - Math.max(1, retryAttempts));
    if (feedback) task.feedback = String(feedback).slice(0, 2000);
    if (checkpoint !== null) {
      if (!isSha(checkpoint?.commit) || !Array.isArray(checkpoint?.files) || !checkpoint.files.length) {
        throw new Error('repair continuation checkpoint is invalid');
      }
      task.repairCheckpoint = {
        commit: checkpoint.commit,
        files: [...new Set(checkpoint.files.map(path => String(path)))],
      };
    }
    state.status = settleStatus(state);
    event(state, 'repair_retry_granted', `${taskId}: one further attempt after reviewer repair`,
      { taskId, actor: 'controller', repairsUsed: task.repairsUsed });
  });
}

export async function acceptProjectFinalReview(root, revision, { reviewer = 'unknown', summary = '' } = {}) {
  return transaction(root, revision, state => {
    if (state.exterminateRequested) throw new Error('run exterminated; review publication refused');
    if (!Number.isSafeInteger(revision) || state.activeTask || !state.tasks.every(task => task.status === 'accepted')) throw new Error('final review not ready');
    if (openEscalations(state).length) throw new Error('resolve every open escalation before closing the run');
    if (state.steering.some(item => !item.applied)) throw new Error('pending steering requires review before completion');
    state.finalReview = true;
    state.status = 'completed';
    event(state, 'final_review', `Combined implementation accepted by ${String(reviewer).slice(0, 120)}. ${String(summary).slice(0, 500)}`, { actor: 'reviewer' });
  });
}

/**
 * A final review that wants cross-cutting corrections sends them BACK TO THE
 * WORKER (mission §4, corrected 2026-09-22) instead of waking Nick.
 *
 * `PASS_WITH_TASKS` is a local verdict. Escalating it inverted what the loop is
 * for — an escalation is a cost, not a safety feature — so the corrections
 * become ordinary tasks, bounded by the run scope and reviewed like any others.
 * They depend on nothing: every planned task is already accepted by this point,
 * so there is no ordering left to express.
 *
 * Throws when a correction reaches outside the run scope or past the correction
 * depth. That refusal is the escalation path, and it is the only one left.
 */
export async function applyFinalReviewCorrections(root, revision, { reviewer = 'unknown', summary = '', corrections = [] } = {}) {
  return transaction(root, revision, state => {
    if (state.exterminateRequested) throw new Error('run exterminated; review publication refused');
    if (state.activeTask || !state.tasks.every(task => task.status === 'accepted')) throw new Error('final review not ready');
    if (openEscalations(state).length) throw new Error('resolve every open escalation before continuing the run');
    if (!Array.isArray(corrections) || !corrections.length) throw new Error('a PASS_WITH_TASKS final review must carry corrections');
    const scope = runScope(state);
    if (!scope.length) throw new Error('this run has no planned scope to inherit');
    const reviewId = randomUUID();
    const deepest = state.tasks.reduce((most, task) => Math.max(most, task.correctionDepth), 0);
    const parent = {
      id: 'final', scope, correctionDepth: deepest,
      checks: [...new Set(state.tasks.flatMap(task => task.checks))].slice(0, 20),
      weight: Math.max(...state.tasks.map(task => task.weight)), risk: 'medium',
    };
    const added = appendCorrections(state, parent, corrections, reviewId, { dependencies: [] });
    state.tasks.push(...added);
    normalizeTaskGraph(state.tasks);
    state.reviews.push({ id: reviewId, taskId: null, commit: null, decision: 'accept_with_tasks', revision, at: stamp(),
      contractDigest: 'final-review', reviewer: String(reviewer).slice(0, 120), verdict: 'PASS_WITH_TASKS',
      summary: String(summary).slice(0, 1500), failed: [], correctionIds: added.map(item => item.id) });
    state.status = settleStatus(state);
    event(state, 'final_review_corrections', `Final review returned ${added.length} correction task(s) to the worker: ${added.map(item => item.id).join(', ')}`,
      { actor: 'reviewer', reviewId, correctionIds: added.map(item => item.id) });
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
/** Resolves true if `promise` settles (either way) within `ms`, false otherwise. */
function settlesWithin(promise, ms) {
  return new Promise(resolve => {
    const timer = setTimeout(() => resolve(false), ms);
    const done = () => { clearTimeout(timer); resolve(true); };
    promise.then(done, done);
  });
}

export async function runProjectAgent(root, { worker, verify, durationMs, taskTimeoutMs = 60000, taskHardTimeoutMs = taskTimeoutMs,
  cancel, settleGraceMs = 60000 } = {}) {
  if (typeof worker !== 'function' || typeof verify !== 'function' || !Number.isSafeInteger(durationMs) || durationMs < 1 ||
      durationMs > 12 * 3600000 || !Number.isSafeInteger(taskTimeoutMs) || taskTimeoutMs < 1 ||
      !Number.isSafeInteger(taskHardTimeoutMs) || taskHardTimeoutMs < taskTimeoutMs ||
      !Number.isSafeInteger(settleGraceMs) || settleGraceMs < 1 || settleGraceMs > 600000) throw new Error('bounded host adapters required');
  const lease = join(root, 'worker.lock');
  await acquireLease(lease, { extra: { role: 'worker', root }, reclaimDead: false });
  let uncertain = false;
  const started = performance.now();
  try {
    let task, instructions;
    const claimed = await transaction(root, undefined, state => {
      if (state.activeTask) { state.status = 'interrupted'; throw new Error('unfinished operation needs reconciliation'); }
      if (['completed', 'interrupted'].includes(state.status)) return;
      // A RUN-level escalation stops everything. A task-level one does not:
      // `claimableTasks` already excludes the parked task, so the loop keeps
      // working through whatever else the plan contains.
      if (openEscalations(state).some(item => item.taskId === null)) { state.status = 'escalated'; return; }
      if (state.stopRequested || state.exterminateRequested) return;
      if (state.pauseRequested) { state.status = 'paused'; return; }
      if (state.tasks.some(item => item.status === 'awaiting_review') || state.tasks.every(item => item.status === 'accepted')) {
        state.status = 'waiting_for_review'; return;
      }
      const claimable = claimableTasks(state);
      // Corrections first. A review found something wrong with work that was
      // just accepted; letting NEW planned work start on top of it means the
      // next task builds on the thing being corrected, and the correction then
      // has to be applied twice. Within each group, plan order is preserved.
      task = claimable.find(item => item.origin !== 'plan') ?? claimable[0];
      if (!task) { state.status = settleStatus(state); return; }
      instructions = state.steering.filter(item => !item.applied).map(item => ({ ...item }));
      for (const item of state.steering) item.applied = true;
      task.status = 'running'; task.stage = 'inspect'; task.attempts++;
      state.status = 'running'; state.activeTask = task.id;
      event(state, 'task_started', task.title, { taskId: task.id, actor: 'worker', attempt: task.attempts });
      task = clone(task);
    });
    if (!task) return claimed;

    const controller = new AbortController();
    /*
     An EXTERMINATE — or a task timeout — reaches the worker through here.

     SETTLE, THEN DECIDE. Both used to mark the outcome UNCERTAIN the instant the
     abort fired: retain the lease, mark the run interrupted, reconcile on next
     start. That is right only when the worker might still be writing, and it
     cost far more than it protected. A timeout ended the whole night, because an
     interrupted run claims nothing more. An exterminate produced a run that
     could not be restarted at all.

     But the worker is an in-process promise. Its model call is raced against
     this signal, its checks are killed by it, and its loop checks it every turn,
     so after an abort it stops within moments. Whether it did is OBSERVABLE: we
     wait (bounded) for its promise to settle. A worker that settled has stopped
     writing, and its outcome is known. Only one that is still running after the
     grace period is genuinely uncertain, and only that keeps the old behaviour.
    */
    let cause = null;
    const onCancel = () => { cause ??= 'cancel'; controller.abort(new Error('exterminated')); };
    if (cancel?.aborted) onCancel();
    else cancel?.addEventListener('abort', onCancel, { once: true });
    let timer, result, rejectCancellation;
    const cancelled = new Promise((_, reject) => {
      rejectCancellation = () => reject(controller.signal.reason ?? new Error("cancelled"));
      if (controller.signal.aborted) rejectCancellation();
      else controller.signal.addEventListener("abort", rejectCancellation, { once: true });
    });
    /*
     The task budget is SOFT: `taskTimeoutMs` is where it starts, and the worker
     may extend it (see agentic/extension.mjs) while it is making progress. It
     can never pass `taskHardTimeoutMs`, or the run's own end.
    */
    const hardAt = performance.now() + Math.max(1, Math.min(taskHardTimeoutMs, durationMs - (performance.now() - started)));
    let deadlineAt = Math.min(hardAt, performance.now() + taskTimeoutMs);
    let expire = null;
    const arm = () => {
      clearTimeout(timer);
      timer = setTimeout(() => { cause ??= 'timeout'; controller.abort(new Error('timeout')); expire?.(new Error('timeout')); },
        Math.max(1, deadlineAt - performance.now()));
    };
    const deadline = Object.freeze({
      remainingMs: () => Math.max(0, deadlineAt - performance.now()),
      hardRemainingMs: () => Math.max(0, hardAt - deadlineAt),
      /** Push the deadline out by up to `ms`; returns what was actually granted. */
      extend: ms => {
        if (controller.signal.aborted || !(ms > 0)) return 0;
        const next = Math.min(hardAt, deadlineAt + ms);
        const granted = Math.max(0, next - deadlineAt);
        if (granted > 0) { deadlineAt = next; arm(); }
        return granted;
      },
    });
    const workerRun = (async () => {
      const candidate = await worker(clone(task), { signal: controller.signal, instructions: clone(instructions), root, deadline });
      // Checked BEFORE verify: a worker that resolves after the timeout must
      // not be able to start host verification and publish a late success.
      if (controller.signal.aborted) throw new Error('cancelled worker');
      if (!candidate || !isSha(candidate.commit) || await verify(clone(task), clone(candidate), controller.signal) !== true) throw new Error('acceptance not verified');
      controller.signal.throwIfAborted();
      return candidate;
    })();
    // Observed separately below; must never surface as an unhandled rejection.
    workerRun.catch(() => {});
    try {
      result = await Promise.race([
        cancelled,
        workerRun,
        new Promise((_, reject) => { expire = reject; arm(); }),
      ]);
    } catch (error) {
      if (controller.signal.aborted) uncertain = !(await settlesWithin(workerRun, settleGraceMs));
      // A model-server timeout or broken inference transport is not evidence
      // that the coding attempt failed. Publish a clean, resumable boundary,
      // refund the attempt, then rethrow so the supervisor's runtime-recovery
      // ladder can ask the reviewer to retry/reload and continue unattended.
      // Task timeouts remain worker_timeout: those describe the task budget,
      // not the availability of the model service.
      const runtimeFailure = !uncertain && cause === null && error?.recoverableRuntime === true;
      await transaction(root, undefined, state => {
        const current = state.tasks.find(item => item.id === task.id);
        current.evidence = null;
        current.subtask = null;
        state.activeTask = null;
        if (runtimeFailure) {
          current.status = 'queued';
          current.stage = 'queued';
          current.attempts = Math.max(0, current.attempts - 1);
          current.blocker = null;
          state.status = settleStatus(state);
          event(state, 'worker_runtime_failure', `${task.id}: inference runtime failed; attempt refunded for automatic recovery`,
            { taskId: task.id, actor: 'controller', error: String(error?.message ?? error) });
          return;
        }
        if (!uncertain && cause === 'cancel') {
          // The operator stopped it; the worker did not fail. Back to the queue
          // with the attempt refunded, so resuming continues rather than
          // counting an exterminate against the task.
          current.status = 'queued';
          current.stage = 'queued';
          current.attempts = Math.max(0, current.attempts - 1);
          current.blocker = null;
          state.status = settleStatus(state);
          event(state, 'worker_cancelled', `${task.id}: stopped by the operator; the worker stopped cleanly and the attempt was refunded`,
            { taskId: task.id, actor: 'operator' });
          return;
        }
        current.status = 'blocked';
        // Five blockers, because they need five different responses: an unknown
        // outcome must not be retried by a second writer; a STUCK or TIMED-OUT
        // worker goes to the reviewer rather than round again; a worker asking
        // for human judgement goes to Nick; anything else is an ordinary failed
        // attempt that the worker retries, told why.
        current.blocker = uncertain ? 'worker_outcome_unknown'
          // A single model call that ran past its own limit (models.mjs
          // "inference timeout") is the same wall as the task timeout: hand it to
          // the reviewer instead of spending the attempt. The live run lost its
          // last attempt to exactly this on 2026-09-24.
          : cause === 'timeout' || /inference timeout/.test(String(error?.message ?? '')) ? 'worker_timeout'
            : error?.detail?.stuck ? 'worker_stuck'
              : error?.detail?.humanOnly ? 'worker_declined'
                : 'worker_or_validation_failed';
        if (current.blocker === 'worker_or_validation_failed') {
          current.feedback = `Your previous attempt did not reach a verified checkpoint: ${String(error?.message ?? error).slice(0, 1500)}`;
        }
        state.status = uncertain ? 'interrupted' : settleStatus(state);
          event(state, 'blocked', `${task.id}: ${current.blocker}`, { taskId: task.id, actor: 'worker', error: String(error?.message ?? error) });
      });
      if (runtimeFailure) throw error;
      return await readProjectAgent(root);
    } finally { clearTimeout(timer); controller.signal.removeEventListener("abort", rejectCancellation); cancel?.removeEventListener('abort', onCancel); }

    return await transaction(root, undefined, state => {
      const current = state.tasks.find(item => item.id === task.id);
      if (state.exterminateRequested || controller.signal.aborted) {
        // The worker FINISHED — we are holding its result — so nothing about its
        // outcome is uncertain. The operator asked for a stop, so the checkpoint
        // is not published: the task goes back to the queue, and the unreviewed
        // commit is removed by the supervisor's reset to the last known checkpoint.
        current.status = 'queued'; current.stage = 'queued'; current.blocker = null;
        current.attempts = Math.max(0, current.attempts - 1);
        current.evidence = null; current.subtask = null; state.activeTask = null;
        state.status = settleStatus(state);
        event(state, 'worker_cancelled', `${task.id}: stopped by the operator after the worker finished; the checkpoint was not published`,
          { taskId: task.id, actor: 'operator' });
        return;
      }
      current.commit = result.commit; current.status = 'awaiting_review'; current.stage = 'review';
      // A fresh checkpoint: the reason it was last sent back has been answered,
      // and any trouble reviewing the previous one no longer applies.
      current.feedback = null;
      current.reviewFailures = 0;
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
      state.status = settleStatus(state);
      event(state, 'review_requested', `${task.id}: verified checkpoint awaits independent review.`,
        { taskId: task.id, actor: 'worker', commit: result.commit, files: result.files ?? [], checks: result.checks ?? [] });
    });
  } finally {
    // Unknown worker lifetime retains the lease. Never start a second writer
    // merely because a timeout was observed; `agentic/lease.mjs` reconciles it
    // only on PROOF that the holder is dead.
    if (!uncertain) await releaseLease(lease);
  }
}
