/*
 The supervisor: the deterministic loop that owns control.

 MODELS PROVIDE INTELLIGENCE; THE RUNTIME PROVIDES CONTROL.

 Nothing here asks a model what stage the run is in, whether a task is done, or
 what should happen next. Those are reads of durable state and branches in
 ordinary code. The models are called at exactly two points — implement, and
 review — and their answers are validated before they can move anything.

 THE LADDER, IMPLEMENTED

   worker self-correction        inside worker.mjs: turns, notices, retries
     -> reviewer review          PASS / PASS_WITH_TASKS / BLOCKED
       -> bounded reviewer repair after `repairAfterAttempts` failed attempts
         -> worker continuation  exactly one further attempt (grantRepairRetry)
           -> escalation         pause, persist, alert Nick, stop

 Each rung is bounded and each bound is configurable. The last rung is a full
 stop: Astra is invoked by a human, never by this process.

 WHY ONE TASK PER `runProjectAgent` CALL

 Every task boundary is also a process boundary: the worker lease is taken and
 released around a single task, state is published and fsynced, and the journal
 is flushed. A crash costs the task in flight, never the night.
*/
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  acceptProjectFinalReview, escalateProjectAgent, grantRepairRetry, markEscalationNotified,
  projectAgentProgress, readProjectAgent, reconcileInterruptedRun, recordReviewerRepair,
  reviewProjectTask, runProjectAgent,
} from '../orion-project-agent.mjs';
import { appendJournal } from './journal.mjs';
import { acquireLease, inspectLease, ownerRecord, releaseLease } from './lease.mjs';
import { notifyEscalation } from './escalation.mjs';
import { commitRepair, repairCheckpoint, reviewCheckpoint, reviewRun, ReviewUnusable } from './reviewer.mjs';
import { createVerifier, createWorker } from './worker.mjs';
import { changedFiles, currentHead, discardToHead } from './workspace.mjs';

const PAUSE_POLL_MS = 15_000;
const HEARTBEAT_MS = 10_000;

const sleep = (ms, signal) => new Promise(resolve => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(timer); resolve(); }, { once: true });
});

/**
 * Liveness, written where the UI and the operator CLI can see it.
 *
 * The Astra handoff noted that the UI's "running" label reflected a snapshot,
 * not a verified heartbeat — a crashed supervisor and a busy one looked
 * identical. A reader compares `at` against now: stale means nothing is
 * driving this run, whatever `status` says.
 */
async function heartbeat(root, payload) {
  await writeFile(join(root, 'heartbeat.json'),
    JSON.stringify({ at: new Date().toISOString(), ...ownerRecord(), ...payload }), { mode: 0o600 })
    .catch(() => {});
}

/** Observation-stream journalling: frequent, unsequenced, never bumps a revision. */
function observer(root, runId) {
  return event => {
    appendJournal(root, { seq: null, runId, kind: event.kind, taskId: event.taskId ?? null,
      actor: event.actor ?? 'agent', data: event.data ?? {} }).catch(() => {});
  };
}

/**
 * Bring a run to a state the loop can act on, or refuse to start.
 *
 * The order matters: nothing touches the worktree until the worker lease has
 * been shown to be free or its holder provably dead.
 */
export async function recoverRun(root, { worktree, emit }) {
  const state = await readProjectAgent(root);
  const lease = await inspectLease(join(root, 'worker.lock'));

  if (lease.held && !lease.dead) {
    throw new Error(
      `a worker lease is held and its owner appears alive (${lease.reason}). ` +
      'Refusing to start a second writer against the same worktree. ' +
      'If you are certain that process is gone, stop it, then retry.');
  }
  if (lease.held && lease.dead) {
    emit({ kind: 'lease_reclaimed', data: { reason: lease.reason, owner: lease.owner } });
    await releaseLease(join(root, 'worker.lock'));
  }

  let current = state;
  if (current.status === 'interrupted') {
    // Safe because the lease holder is provably dead by this point.
    current = await reconcileInterruptedRun(root, current.revision, {
      deadOwnerProof: { dead: true, reason: lease.held ? lease.reason : 'no worker lease was held at recovery' },
    });
  }

  // Uncommitted work is not state. The last ACCEPTED commit is the only thing
  // this system treats as real, so a half-written mutation is discarded rather
  // than guessed at — which is what makes partial-write recovery a decision
  // rather than an archaeology problem.
  const dirty = await changedFiles(worktree);
  if (dirty.length) {
    const discarded = await discardToHead(worktree);
    emit({ kind: 'partial_work_discarded', data: { files: discarded.discarded, head: discarded.head } });
  }
  return { state: current, head: await currentHead(worktree), reclaimed: lease.held && lease.dead };
}

function watchdog({ limits }) {
  let lastRevision = null, stalled = 0, consecutiveFailures = 0;
  const blockerCounts = new Map();
  return {
    observe(state, { progressed }) {
      if (state.revision === lastRevision && !progressed) stalled += 1; else stalled = 0;
      lastRevision = state.revision;
      if (progressed) consecutiveFailures = 0;
      for (const task of state.tasks) {
        if (task.status !== 'blocked' || !task.blocker) continue;
        const key = `${task.id}:${task.blocker}`;
        blockerCounts.set(key, (blockerCounts.get(key) ?? 0) + 1);
      }
      return this.verdict();
    },
    failed() { consecutiveFailures += 1; return this.verdict(); },
    verdict() {
      if (stalled >= limits.iterationStallLimit) {
        return { trip: true, kind: 'no_progress', reason: `${stalled} supervisor iterations produced no state change` };
      }
      if (consecutiveFailures >= limits.maxConsecutiveFailures) {
        return { trip: true, kind: 'repeated_failure', reason: `${consecutiveFailures} consecutive failures in the supervisor loop` };
      }
      const repeated = [...blockerCounts.entries()].find(([, count]) => count >= limits.maxConsecutiveFailures * 2);
      if (repeated) return { trip: true, kind: 'repeated_failure', reason: `the same blocker recurred: ${repeated[0]}` };
      return { trip: false };
    },
  };
}

/**
 * Run the loop until the budget is spent, the run completes, or it escalates.
 * Returns a summary; never throws for an ordinary failure, because an
 * unattended process that dies on an exception has told nobody.
 */
export async function superviseRun(root, {
  repoRoot, worktree, baseRef, runtime, config, project = 'ORION',
  durationMs = 8 * 3600_000, signal, now = () => Date.now(),
  // Injectable so a test can never reach the real Discord webhook. Alerts on
  // this machine are live; a suite that sent one would wake Nick to tell him a
  // test passed.
  notify = notifyEscalation,
} = {}) {
  const limits = config.limits;
  const supervisorLease = join(root, 'supervisor.lock');
  const acquired = await acquireLease(supervisorLease, { extra: { role: 'supervisor', root } });
  const started = now();
  const summary = { iterations: 0, tasksAccepted: 0, reviews: 0, repairs: 0, escalated: null, reclaimed: acquired.reclaimed };
  let beat;

  try {
    const probe = await runtime.probe();
    // The observer is built BEFORE recovery: a lease reclaim and a discarded
    // partial write are exactly the events a morning post-mortem needs, and a
    // closure over a not-yet-assigned `emit` would have dropped both.
    const emit = observer(root, (await readProjectAgent(root)).runId);
    const recovery = await recoverRun(root, { worktree, emit });
    emit({ kind: 'supervisor_started', data: { project, probe, durationMs, baseRef, head: recovery.head, reclaimedLease: acquired.reclaimed } });

    const guard = watchdog({ limits });
    const worker = createWorker({ runtime, worktree, emit });
    const verify = createVerifier({ worktree });
    beat = setInterval(() => heartbeat(root, { phase: 'loop', iterations: summary.iterations, runId: recovery.state.runId }), HEARTBEAT_MS);

    while (!signal?.aborted && now() - started < durationMs) {
      summary.iterations += 1;
      let state = await readProjectAgent(root);
      const progress = projectAgentProgress(state);
      await heartbeat(root, { phase: state.status, iterations: summary.iterations, runId: state.runId, percent: progress.percent, activeTask: state.activeTask });

      if (state.status === 'completed') { emit({ kind: 'run_completed', data: progress }); break; }

      if (state.status === 'escalated') {
        const notification = await notify(state, { root, worktree, baseRef, project });
        if (notification.delivered && !state.escalation.notified) {
          await markEscalationNotified(root, state.revision, state.escalation.id).catch(() => {});
        }
        emit({ kind: 'escalation_notified', data: { delivered: notification.delivered, reason: notification.reason, brief: notification.briefPath } });
        summary.escalated = { kind: state.escalation.kind, reason: state.escalation.reason, notified: notification.delivered, brief: notification.briefPath };
        break;
      }

      if (state.status === 'paused') {
        // Hold the lease and wait rather than exiting: Nick pauses from the UI,
        // thinks, resumes, and the run continues without needing a relaunch.
        await heartbeat(root, { phase: 'paused', iterations: summary.iterations, runId: state.runId });
        await sleep(PAUSE_POLL_MS, signal);
        continue;
      }

      const awaiting = state.tasks.find(task => task.status === 'awaiting_review');
      if (awaiting) {
        const outcome = await handleReview({ root, state, task: awaiting, runtime, worktree, baseRef, emit });
        summary.reviews += 1;
        if (outcome.accepted) summary.tasksAccepted += 1;
        await trip(guard, outcome.progressed, root, emit);
        continue;
      }

      const repairable = state.tasks.find(task =>
        task.status === 'blocked' &&
        task.repairsUsed < 1 &&
        task.attempts >= limits.repairAfterAttempts &&
        task.blocker !== 'worker_outcome_unknown');
      if (repairable) {
        const outcome = await handleRepair({ root, state, task: repairable, runtime, worktree, baseRef, emit, limits,
          lastChecks: repairable.evidence?.checks ?? [] });
        summary.repairs += 1;
        await trip(guard, outcome.progressed, root, emit);
        continue;
      }

      const claimable = state.tasks.some(task => task.status === 'queued' && task.attempts < state.maxAttempts &&
        task.dependencies.every(id => state.tasks.find(item => item.id === id)?.status === 'accepted'));

      if (!claimable) {
        if (state.tasks.every(task => task.status === 'accepted') && !state.finalReview) {
          const outcome = await handleFinalReview({ root, state, runtime, worktree, baseRef, emit });
          await trip(guard, outcome.progressed, root, emit);
          continue;
        }
        const blocked = state.tasks.filter(task => task.status === 'blocked');
        await escalate(root, state, {
          kind: blocked.length ? 'repeated_failure' : 'no_work',
          reason: blocked.length
            ? `${blocked.length} task(s) are blocked and the local loop has no remaining move: ${blocked.map(task => `${task.id} (${task.blocker})`).join(', ')}`
            : 'no task can be claimed and the run is not complete; the plan may have an unsatisfiable dependency',
          taskId: blocked[0]?.id ?? null,
          recommendAstra: true,
          question: blocked.length ? 'Should these tasks be re-scoped, re-planned, or dropped?' : 'The task graph needs a human look.',
        }, emit);
        continue;
      }

      const before = state.revision;
      state = await runProjectAgent(root, {
        worker, verify, durationMs: Math.max(1, Math.min(durationMs - (now() - started), limits.taskTimeoutMs * 2)),
        taskTimeoutMs: limits.taskTimeoutMs,
      });
      await trip(guard, state.revision > before, root, emit);
    }

    if (!signal?.aborted && now() - started >= durationMs) {
      const state = await readProjectAgent(root);
      if (!['completed', 'escalated', 'paused'].includes(state.status)) {
        emit({ kind: 'budget_exhausted', data: { durationMs, iterations: summary.iterations } });
      }
    }
    return { ...summary, state: await readProjectAgent(root) };
  } finally {
    clearInterval(beat);
    await heartbeat(root, { phase: 'stopped', iterations: summary.iterations }).catch(() => {});
    await runtime.releaseAll().catch(() => {});
    await releaseLease(supervisorLease).catch(() => {});
  }
}

/**
 * Feed one iteration's outcome to the watchdog and escalate if it trips.
 *
 * Every branch of the loop routes through this. An earlier shape checked the
 * verdict only on the worker branch, which meant a run could ping-pong between
 * review and repair forever without the watchdog ever being consulted.
 */
async function trip(guard, progressed, root, emit) {
  const state = await readProjectAgent(root);
  const verdict = guard.observe(state, { progressed });
  if (!progressed) guard.failed();
  const final = progressed ? verdict : guard.verdict();
  if (!final.trip || state.status === 'escalated') return;
  await escalate(root, state, {
    kind: final.kind, reason: final.reason, recommendAstra: false,
    question: 'The loop stopped making progress. Read the last journal entries before restarting it.',
  }, emit);
}

async function escalate(root, state, details, emit) {
  const escalated = await escalateProjectAgent(root, state.revision, details).catch(error => {
    emit({ kind: 'escalation_failed', data: { reason: String(error.message ?? error) } });
    return null;
  });
  if (escalated) emit({ kind: 'escalation_raised', data: { kind: details.kind, reason: details.reason, taskId: details.taskId ?? null } });
  return escalated;
}

async function handleReview({ root, state, task, runtime, worktree, baseRef, emit }) {
  const priorFindings = state.reviews.filter(review => review.taskId === task.id).flatMap(review => review.failed ?? []);
  let outcome;
  try {
    outcome = await reviewCheckpoint({
      runtime, worktree, task, baseRef,
      checkResults: task.evidence?.checks ?? [], workerSummary: task.evidence?.summary ?? '', priorFindings, emit,
    });
  } catch (error) {
    if (error instanceof ReviewUnusable) {
      // A reviewer that cannot produce a usable review is never resolved as an
      // accept. It escalates — the gate failing closed is the gate working.
      await escalate(root, state, {
        kind: 'judgement', taskId: task.id, recommendAstra: true,
        reason: `the review model could not produce a valid review for ${task.id}: ${error.detail?.lastError ?? error.message}`,
        question: 'Review this checkpoint yourself, or swap the reviewer model.',
      }, emit);
      return { accepted: false, progressed: true };
    }
    throw error;
  }

  const { review } = outcome;
  const decision = review.verdict === 'PASS' ? 'accept'
    : review.verdict === 'PASS_WITH_TASKS' ? 'accept_with_tasks' : 'blocked';
  try {
    await reviewProjectTask(root, {
      revision: state.revision, taskId: task.id, commit: task.commit, decision,
      review: { ...review, reviewer: outcome.model },
    });
  } catch (error) {
    // A PASS_WITH_TASKS whose corrections the controller refuses (depth
    // exceeded, scope widened) must not silently become a plain accept.
    await escalate(root, await readProjectAgent(root), {
      kind: 'architecture', taskId: task.id, recommendAstra: true,
      reason: `the reviewer's verdict could not be applied: ${error.message}`,
      question: "The review wanted corrections the run's bounds do not permit. Re-plan or raise the bound.",
    }, emit).catch(() => {});
    return { accepted: false, progressed: true };
  }

  if (review.verdict === 'BLOCKED') {
    await escalate(root, await readProjectAgent(root), {
      kind: review.escalationKind ?? 'judgement', taskId: task.id,
      reason: review.escalationReason || review.summary,
      recommendAstra: ['architecture', 'contradiction', 'astra'].includes(review.escalationKind ?? ''),
      question: review.summary,
    }, emit);
  }
  return { accepted: decision !== 'blocked', progressed: true };
}

async function handleRepair({ root, state, task, runtime, worktree, baseRef, emit, limits, lastChecks = [] }) {
  const history = `The worker made ${task.attempts} attempt(s) and is blocked with "${task.blocker}". ` +
    `It has had ${task.corrections} correction cycle(s). The repair threshold is ${limits.repairAfterAttempts} attempts.`;
  const repair = await repairCheckpoint({ runtime, worktree, task, baseRef, checkResults: lastChecks, history, emit });

  if (!repair.repaired) {
    await escalate(root, state, {
      kind: repair.escalate?.kind ?? 'judgement', taskId: task.id,
      reason: `bounded reviewer repair declined: ${repair.escalate?.reason ?? 'no reason given'}`,
      recommendAstra: true, question: 'The local ladder is exhausted for this task.',
    }, emit);
    return { progressed: true };
  }

  const committed = await commitRepair(worktree, task, repair);
  await recordReviewerRepair(root, state.revision, {
    taskId: task.id, model: repair.model, files: repair.files,
    summary: `${repair.diagnosis} — ${repair.rationale}${repair.improved ? '' : ' (checks still failing after the repair)'}`,
    commit: committed.commit,
  });
  emit({ kind: 'reviewer_repair_committed', taskId: task.id, data: { files: repair.files, commit: committed.commit, improved: repair.improved } });

  if (!repair.improved) {
    // A repair that did not help is not a reason to spend another worker
    // attempt on the same wall.
    await escalate(root, await readProjectAgent(root), {
      kind: 'repeated_failure', taskId: task.id, recommendAstra: true,
      reason: `the reviewer repaired ${repair.files.join(', ')} and the checks still fail`,
      question: 'Both local models have now failed on this task.',
    }, emit);
    return { progressed: true };
  }
  const after = await readProjectAgent(root);
  await grantRepairRetry(root, after.revision, task.id).catch(error =>
    emit({ kind: 'repair_retry_refused', taskId: task.id, data: { reason: String(error.message ?? error) } }));
  return { progressed: true };
}

async function handleFinalReview({ root, state, runtime, worktree, baseRef, emit }) {
  let outcome;
  try {
    outcome = await reviewRun({ runtime, worktree, baseRef, tasks: state.tasks, reviews: state.reviews, emit });
  } catch (error) {
    await escalate(root, state, {
      kind: 'judgement', recommendAstra: true,
      reason: `the final review could not be completed: ${error.message}`,
      question: 'Every task was accepted individually; the combined review needs you.',
    }, emit);
    return { progressed: true };
  }

  if (outcome.review.verdict === 'PASS') {
    await acceptProjectFinalReview(root, state.revision, { reviewer: outcome.model, summary: outcome.review.summary });
    emit({ kind: 'final_review_passed', data: { model: outcome.model, summary: outcome.review.summary } });
    return { progressed: true };
  }
  // PASS_WITH_TASKS at the end is deliberately NOT turned into tasks. A
  // cross-cutting correction has no parent task to inherit scope from, and
  // inventing one would let a review grant itself reach no human approved.
  await escalate(root, state, {
    kind: outcome.review.verdict === 'BLOCKED' ? (outcome.review.escalationKind ?? 'judgement') : 'final_review_corrections',
    recommendAstra: true,
    reason: outcome.review.escalationReason || outcome.review.summary,
    question: outcome.review.corrections?.length
      ? `The final review wants ${outcome.review.corrections.length} cross-cutting correction(s): ${outcome.review.corrections.map(item => item.title).join('; ')}. Turn these into task contracts or accept the run as it stands.`
      : 'The combined run did not pass final review.',
  }, emit);
  return { progressed: true };
}

/** Make the run directory before anything writes into it. */
export async function ensureRunRoot(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  return root;
}
