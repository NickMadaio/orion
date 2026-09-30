/*
 The supervisor: the deterministic loop that owns control.

 MODELS PROVIDE INTELLIGENCE; THE RUNTIME PROVIDES CONTROL.

 Nothing here asks a model what stage the run is in, whether a task is done, or
 what should happen next. Those are reads of durable state and branches in
 ordinary code. The models are called at exactly two points — implement, and
 review — and their answers are validated before they can move anything.

 THE LADDER, IMPLEMENTED

   worker self-review and       inside worker.mjs: signal-triggered checkpoints,
   self-correction              turns, notices, repetition detection
     -> reviewer review          PASS / PASS_WITH_TASKS / BLOCKED
       -> corrections            PASS_WITH_TASKS returns work to the WORKER,
                                 within the parent's scope — or, at final
                                 review, within the run scope
         -> bounded repair       after `repairAfterAttempts` failed attempts,
                                 at most `repairMaxFiles` files
           -> worker continuation `repairRetryAttempts` further attempts
             -> deferral         the task is parked for Astra and independent
                                 work carries on; one digest when the run stops

 Each rung is bounded and every bound is configuration, not a constant. The
 shape of the ladder is architecture; the numbers on it are meant to be measured
 and tuned. The last rung is a full stop: Astra is invoked by a human, never by
 this process — and it is a COST, so every rung above it exists to avoid needing
 it.

 WHY ONE TASK PER `runProjectAgent` CALL

 Every task boundary is also a process boundary: the worker lease is taken and
 released around a single task, state is published and fsynced, and the journal
 is flushed. A crash costs the task in flight, never the night.
*/
import { mkdir, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  acceptProjectFinalReview, applyFinalReviewCorrections, claimableTasks, escalateProjectAgent,
  grantRepairRetry, markEscalationNotified,
  projectAgentProgress, readProjectAgent, reconcileInterruptedRun, recordReviewerRepair,
  recordReviewFailure, returnTaskToWorker, reviewProjectTask, retryFailedProjectTask, runProjectAgent, setTaskSubtask,
} from '../orion-project-agent.mjs';
import { appendJournal, readJournal } from './journal.mjs';
import { acquireLease, inspectLease, ownerRecord, releaseLease } from './lease.mjs';
import { recoverRuntime } from './recovery.mjs';
import { ActivityChannel } from './activity.mjs';
import { notifyEscalation, notifyReviewerRepair, notifyWorkerStuck, notifyRuntimeRecovery } from './escalation.mjs';
import { commitRepair, repairCheckpoint, reviewCheckpoint, reviewRun, ReviewUnusable } from './reviewer.mjs';
import { createVerifier, createWorker } from './worker.mjs';
import { changedFiles, currentHead, discardToHead, resetToKnownCheckpoint } from './workspace.mjs';

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
  // Readers poll this file while the supervisor writes it. Writing the final
  // path directly briefly exposes a truncated JSON document, which made the UI
  // drop a live heartbeat and render “Stopped” beside a still-running loop.
  const path = join(root, 'heartbeat.json');
  const temporary = join(root, `.heartbeat-${process.pid}.tmp`);
  await writeFile(temporary,
    JSON.stringify({ at: new Date().toISOString(), ...ownerRecord(), ...payload }), { mode: 0o600 })
    .then(() => rename(temporary, path))
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
 * The commits this run treats as REAL: its base, every recorded checkpoint, and
 * every recorded reviewer repair. Anything else on the run branch is a commit no
 * review has seen, and `resetToKnownCheckpoint` removes it before work restarts.
 */
export function knownCheckpoints(state, baseRef) {
  return [
    baseRef,
    ...state.tasks.filter(task => ['awaiting_review', 'accepted'].includes(task.status)).map(task => task.commit),
    ...(state.repairs ?? []).map(repair => repair.commit),
  ].filter(Boolean);
}

/**
 * Return the tree to the last known checkpoint — unless a worker lease is held,
 * because a possibly-live writer must never have the ground moved under it.
 * Journals what it removed, since a discarded commit is exactly the kind of
 * thing a morning post-mortem needs to see.
 */
/*
 Whose unfinished work is in the tree, and may it be kept?

 Unreviewed work is never built on by ANOTHER task. But wiping a task's own
 half-finished files when that same task is resumed threw away a night's work
 twice on the first real run (23 of 24 tests passing, discarded, restarted from
 scratch). So: kept only when every dirty file is inside the task's scope, the
 task is not accepted, and it was the last task the worker wrote for. It is
 still unreviewed: it must pass the checks and the independent review.
*/
async function carryoverTask(root, state, worktree, only = null) {
  const dirty = (await changedFiles(worktree)).map(file => file.path);
  if (!dirty.length) return null;
  const writes = await readJournal(root, { kinds: ['worker_write'], limit: 1 });
  const last = writes.at(-1)?.taskId;
  const task = state.tasks.find(item => item.id === last);
  if (!task || task.status === 'accepted' || (only && task.id !== only)) return null;
  const inScope = path => task.scope.some(entry => (entry.endsWith('/') ? path.startsWith(entry) : path === entry));
  return dirty.every(inScope) ? task.id : null;
}

async function resetTree(root, { worktree, baseRef, emit, keepWork = false, why }) {
  if (!baseRef) return null;
  if ((await inspectLease(join(root, 'worker.lock'))).held) return null;
  const state = await readProjectAgent(root);
  const result = await resetToKnownCheckpoint(worktree, knownCheckpoints(state, baseRef), { keepWork });
  if (result.reset) {
    emit({ kind: 'reset_to_known_checkpoint', data: { why, keepWork, target: result.target,
      strayCommits: result.strayCommits, discarded: result.discarded } });
  }
  return result;
}

/**
 * Bring a run to a state the loop can act on, or refuse to start.
 *
 * The order matters: nothing touches the worktree until the worker lease has
 * been shown to be free or its holder provably dead.
 */
export async function recoverRun(root, { worktree, emit, baseRef = null }) {
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
  if (current.status === 'interrupted' || current.activeTask) {
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
  if (baseRef) {
    // A crash can leave a COMMIT nobody reviewed as well as a half-written file.
    const carried = await carryoverTask(root, current, worktree);
    const reset = await resetToKnownCheckpoint(worktree, knownCheckpoints(current, baseRef), { keepWork: Boolean(carried) });
    if (carried) emit({ kind: 'partial_work_kept', data: { taskId: carried, files: dirty.map(file => file.path) } });
    if (reset.reset && !carried) emit({ kind: 'partial_work_discarded', data: { files: reset.discarded, head: reset.target, strayCommits: reset.strayCommits } });
  } else if (dirty.length) {
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
  // Injectable for the same reason as `notify`: Discord is live on this machine.
  notifyRepair = notifyReviewerRepair,
  notifyStuck = notifyWorkerStuck,
  notifyRecovery = notifyRuntimeRecovery,
  // A seam, not a knob: the kill switch is polled on this tick, and a test that
  // had to wait ten real seconds to prove EXTERMINATE works would not be run.
  heartbeatMs = HEARTBEAT_MS,
  checkpointRepair = commitRepair,
} = {}) {
  const limits = config.limits;
  const supervisorLease = join(root, 'supervisor.lock');
  const acquired = await acquireLease(supervisorLease, { extra: { role: 'supervisor', root } });
  const started = now();
  const summary = { iterations: 0, tasksAccepted: 0, reviews: 0, repairs: 0, escalated: null, reclaimed: acquired.reclaimed };
  // Which model is working right now. The UI needs to name it: "running" with
  // no actor is the least informative thing an overnight panel can say.
  const active = { role: 'idle', model: null, since: null };
  // The live thinking channel. Cosmetic by design: it is overwritten in place,
  // never fsynced, and losing it costs nothing — the journal is the record.
  const activity = new ActivityChannel(root);
  /*
   The kill switch, owned here.

   Nick can ask for EXTERMINATE from the panel or from his phone, and that is a
   durable flag rather than a signal — the process that has to act on it is this
   one, and it may be mid-way through a nine-minute generation at the time. So
   the heartbeat tick, which is already reading state every few seconds, trips
   this controller, and the abort reaches the model through `runProjectAgent`.
  */
  const kill = new AbortController();
  let beat;

  try {
    const probe = await runtime.probe();
    // The observer is built BEFORE recovery: a lease reclaim and a discarded
    // partial write are exactly the events a morning post-mortem needs, and a
    // closure over a not-yet-assigned `emit` would have dropped both.
    const emit = observer(root, (await readProjectAgent(root)).runId);
    runtime.setObserver?.(emit);
    const recovery = await recoverRun(root, { worktree, emit, baseRef });
    emit({ kind: 'supervisor_started', data: { project, probe, durationMs, baseRef, head: recovery.head, reclaimedLease: acquired.reclaimed } });

    const guard = watchdog({ limits });
    const worker = createWorker({ runtime, worktree, emit, maxAttempts: limits.maxAttempts, activity,
      stuckAfterTurns: limits.stuckAfterTurns,
      extension: { maxGrantMs: limits.extensionMaxGrantMs ?? 0, defaultGrantMs: limits.extensionDefaultGrantMs ?? 0,
        maxTurnsHard: limits.maxTurnsHard ?? 14 },
      onSubtask: (taskId, subtask) => setTaskSubtask(root, taskId, subtask) });
    const verify = createVerifier({ worktree });
    beat = setInterval(() => {
      heartbeat(root, {
        phase: 'loop', iterations: summary.iterations, runId: recovery.state.runId,
        role: active.role, model: active.model, roleSince: active.since,
      });
      // Cheap, and the only way an operator request can interrupt a generation
      // already in flight.
      readProjectAgent(root)
        .then(current => {
          if (current.exterminateRequested && !kill.signal.aborted) {
            emit({ kind: 'exterminate_requested', data: { revision: current.revision } });
            kill.abort(new Error('exterminated by the operator'));
          }
        })
        .catch(() => {});
    }, heartbeatMs);

    while (!signal?.aborted && !kill.signal.aborted && now() - started < durationMs) {
      summary.iterations += 1;
      try {
        if (await iterate()) break;
      } catch (error) {
        const current = await readProjectAgent(root);
        if (kill.signal.aborted || current.exterminateRequested) {
          if (!kill.signal.aborted) kill.abort(new Error('exterminated by the operator'));
          summary.stoppedByOperator = 'exterminate';
          emit({ kind: 'operation_cancelled', data: { reason: String(error.message ?? error) } });
          break;
        }
        // An unattended process that dies on an exception has told nobody. A
        // failed iteration is journalled and counted; the watchdog ends the run
        // and escalates if they keep happening, which is a stop Nick hears
        // about rather than a process that is simply gone in the morning.
        emit({ kind: 'iteration_failed', data: { iteration: summary.iterations, error: String(error?.message ?? error) } });
        const recovered = await recoverRuntime({ root, runtime, error, phase: active.phase ?? active.role,
          signal: AbortSignal.any([kill.signal, ...(signal ? [signal] : [])]), limits, emit,
          notify: (...args) => informIfAway(root, () => notifyRecovery(...args)),
          backoffMs: limits.runtimeRecoveryBackoffMs, settleMs: limits.resourceSettleMs });
        const latest = await readProjectAgent(root);
        if (latest.stopRequested || latest.exterminateRequested || signal?.aborted) break;
        // `pauseRequested` is the field; `latest.paused` never existed, so a pause
        // that had not yet reached a boundary fell through to a run-level escalation.
        if (latest.pauseRequested || latest.status === 'paused') continue;
        if (recovered) continue;
        await escalate(root, latest, {
          kind: 'repeated_failure', recommendAstra: true,
          reason: `runtime recovery could not resume ${active.phase ?? active.role}; last error: ${String(error?.message ?? error)}`,
          question: 'Review the durable runtime recovery record before restarting.',
        }, emit);
        await iterate(); // Deliver the terminal escalation before returning.
        break;
      }
    }

    function mark(role, model) {
      if (role === 'idle' && active.role !== 'idle') activity.idle();
      if (active.role !== role) active.since = new Date().toISOString();
      active.role = role;
      active.model = model;
    }

    /** One pass. Returns true when the loop should stop. */
    async function iterate() {
      mark('idle', null);
      active.phase = 'dispatch';
      let state = await readProjectAgent(root);
      const progress = projectAgentProgress(state);
      await heartbeat(root, { phase: state.status, iterations: summary.iterations, runId: state.runId,
        percent: progress.percent, activeTask: state.activeTask,
        role: active.role, model: active.model, roleSince: active.since });

      if (state.status === 'completed') { emit({ kind: 'run_completed', data: progress }); return true; }

      // STOP is checked before anything is claimed, so the boundary we end on
      // is one where the tree is clean, state is published and the run is
      // trivially resumable.
      if (state.stopRequested) {
        emit({ kind: 'run_stopped_by_operator', data: {
          exterminate: state.exterminateRequested === true, iterations: summary.iterations, progress } });
        summary.stoppedByOperator = state.exterminateRequested ? 'exterminate' : 'stop';
        return true;
      }

      // Alert on anything newly escalated, whether or not the loop can carry on.
      // A parked task still needs Nick told about it -- he just does not need to
      // get up, because the rest of the plan is still moving.
      const open = (state.escalations ?? []).filter(item => !item.resolvedAt);
      const unreported = open.filter(item => !item.notified);
      let terminalAlertWasAttempted = false;
      // A stopped run sends one digest of everything open. Before that, a
      // deferral is sent on its own only when Nick is away; asleep, it waits
      // for the digest. A run-level escalation always stops the run, so it
      // always goes out -- as the digest.
      const terminal = state.status === 'escalated';
      const quiet = state.alertMode !== 'away';
      if (unreported.length && !terminal && quiet) {
        emit({ kind: 'deferral_held', data: { count: unreported.length, taskIds: unreported.map(item => item.taskId) } });
      } else if (unreported.length) {
        const notification = await notify(state, { root, worktree, baseRef, repoRoot, project, force: terminal,
          digest: terminal, silent: terminal && quiet });
        terminalAlertWasAttempted = notification.attempted === true;
        for (const result of notification.results ?? []) {
          if (result.delivered) {
            const fresh = await readProjectAgent(root);
            await markEscalationNotified(root, fresh.revision, result.id).catch(() => {});
          }
        }
        emit({ kind: 'escalation_notified', data: {
          count: unreported.length, delivered: notification.delivered, reason: notification.reason } });
        state = await readProjectAgent(root);
      }

      if (state.status === 'escalated') {
        // A terminal escalation has no next loop pass. Retry a transient alert
        // failure here, bounded, while the heartbeat and lease still prove the
        // supervisor is alive. Silence at 01:00 is the failure this path exists
        // to prevent.
        for (let attempt = 1; terminalAlertWasAttempted && attempt < limits.escalationAlertAttempts; attempt += 1) {
          const pending = (state.escalations ?? []).filter(item => !item.resolvedAt && !item.notified);
          if (!pending.length) break;
          await sleep(limits.escalationAlertRetryMs, undefined, {
            signal: AbortSignal.any([kill.signal, ...(signal ? [signal] : [])]),
          });
          const notification = await notify(state, { root, worktree, baseRef, repoRoot, project, force: true,
            digest: true, silent: state.alertMode !== 'away' });
          for (const result of notification.results ?? []) {
            if (result.delivered) {
              const fresh = await readProjectAgent(root);
              await markEscalationNotified(root, fresh.revision, result.id).catch(() => {});
            }
          }
          emit({ kind: 'escalation_notification_retry', data: {
            attempt: attempt + 1, delivered: notification.delivered, reason: notification.reason,
          } });
          state = await readProjectAgent(root);
        }
        // Only now is the run actually stuck: either a run-level escalation, or
        // nothing claimable remains. Task-level escalations do NOT reach here
        // while other work is available.
        summary.escalated = open.map(item => ({ kind: item.kind, taskId: item.taskId, reason: item.reason, notified: item.notified }));
        emit({ kind: 'run_stopped', data: { open: open.length, reason: 'no claimable work remains' } });
        return true;
      }

      if (state.status === 'paused') {
        // Hold the lease and wait rather than exiting: Nick pauses from the UI,
        // thinks, resumes, and the run continues without needing a relaunch.
        await heartbeat(root, { phase: 'paused', iterations: summary.iterations, runId: state.runId });
        await sleep(PAUSE_POLL_MS, undefined, {
          signal: AbortSignal.any([kill.signal, ...(signal ? [signal] : [])]),
        });
        return false;
      }

      const awaiting = state.tasks.find(task => task.status === 'awaiting_review');
      if (awaiting) {
        active.phase = `review:${awaiting.id}`;
        mark('reviewer', runtime.spec?.('reviewer')?.model ?? null);
        const outcome = await handleReview({ root, state, task: awaiting, runtime, worktree, baseRef, emit, activity, signal: kill.signal });
        summary.reviews += 1;
        if (outcome.accepted) summary.tasksAccepted += 1;
        await trip(guard, outcome.progressed, root, emit);
        return false;
      }

      /*
       Who the reviewer may try to unblock.

       Two doors into the same rung. The ordinary one is a worker that has spent
       its attempts. The other is a worker that got STUCK — no new file, no check
       fixed, several exchanges running — and that one does not wait for the
       attempt budget to run out, because spending two more attempts against the
       same wall is exactly what being stuck means.
      */
      const handOverAtOnce = task => ['worker_stuck', 'worker_timeout'].includes(task.blocker);
      const repairable = state.tasks.find(task =>
        task.status === 'blocked' && !state.escalations.some(item => !item.resolvedAt && item.taskId === task.id) &&
        ['worker_stuck', 'worker_timeout', 'worker_or_validation_failed', 'repair_budget_exhausted'].includes(task.blocker) &&
        task.repairsUsed < limits.repairsPerTask &&
        // Stuck and timed out do not wait for the attempt budget: another attempt
        // against the same wall is exactly what they are evidence against.
        (handOverAtOnce(task) || task.attempts >= limits.repairAfterAttempts) &&
        task.blocker !== 'worker_outcome_unknown');
      if (repairable) {
        // Keep the worker's partial attempt as files — it is the reviewer's best
        // evidence — but take any commit it made out of history, so the repair
        // commit records only what the reviewer itself wrote.
        await resetTree(root, { worktree, baseRef, emit, keepWork: true, why: `repair:${repairable.id}` });
        active.phase = `repair:${repairable.id}`;
        mark('reviewer', runtime.spec?.('reviewer')?.model ?? null);
        const outcome = await handleRepair({ root, state, task: repairable, runtime, worktree, baseRef, emit, limits, activity, project, notifyRepair, notifyStuck,
          lastChecks: repairable.evidence?.checks ?? [], signal: kill.signal, checkpointRepair });
        summary.repairs += 1;
        await trip(guard, outcome.progressed, root, emit);
        return false;
      }

      const retryable = state.tasks.find(task => task.status === 'blocked' &&
        task.blocker === 'worker_or_validation_failed' && task.attempts < state.maxAttempts &&
        !state.escalations.some(item => !item.resolvedAt && (item.taskId === null || item.taskId === task.id)));
      if (retryable) {
        // The failed attempt has settled and released its lease. Retry from the
        // checkpoint, never from an unrecorded half-write.
        const lease = await inspectLease(join(root, 'worker.lock'));
        if (lease.held) throw new Error('cannot retry while a worker lease remains held');
        await resetTree(root, { worktree, baseRef, emit, why: `retry:${retryable.id}` });
        const fresh = await readProjectAgent(root);
        await retryFailedProjectTask(root, fresh.revision, retryable.id);
        emit({ kind: 'worker_retry', taskId: retryable.id, data: { attemptsUsed: retryable.attempts, maxAttempts: state.maxAttempts } });
        return false;
      }

      const claimable = claimableTasks(state).length > 0;

      if (!claimable) {
        if (state.tasks.every(task => task.status === 'accepted') && !state.finalReview) {
          active.phase = 'final_review';
          mark('reviewer', runtime.spec?.('reviewer')?.model ?? null);
          const outcome = await handleFinalReview({ root, state, runtime, worktree, baseRef, emit, activity, signal: kill.signal });
          await trip(guard, outcome.progressed, root, emit);
          return false;
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
        return false;
      }

      // Every attempt starts from a checkpoint this run knows about. Leftovers
      // from a blocked task — or a commit no review saw — would otherwise make
      // the NEXT task's tree dirty and fail its verification for a reason it
      // had nothing to do with.
      // The task about to be claimed keeps its own unfinished files (see
      // carryoverTask); anything else is discarded as before.
      const next = claimableTasks(state);
      // Same choice runProjectAgent makes: corrections before planned work.
      const carried = await carryoverTask(root, state, worktree, (next.find(item => item.origin !== 'plan') ?? next[0])?.id ?? null);
      if (carried) emit({ kind: 'partial_work_kept', data: { taskId: carried } });
      await resetTree(root, { worktree, baseRef, emit, keepWork: Boolean(carried), why: 'claim' });
      const before = state.revision;
      mark('worker', runtime.spec?.('worker')?.model ?? null);
      state = await runProjectAgent(root, {
        worker, verify, durationMs: Math.max(1, Math.min(durationMs - (now() - started),
          Math.max(limits.taskTimeoutMs * 2, limits.taskHardTimeoutMs ?? 0))),
        taskTimeoutMs: limits.taskTimeoutMs,
        taskHardTimeoutMs: Math.max(limits.taskTimeoutMs, limits.taskHardTimeoutMs ?? limits.taskTimeoutMs), cancel: kill.signal, settleGraceMs: limits.settleGraceMs ?? 60_000,
      });
      await trip(guard, state.revision > before, root, emit);
      return false;
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
    if (kill.signal.aborted) {
      // Abrupt, not destructive: a half-written mutation is discarded back to
      // the last accepted commit, which is the only state this system treats as
      // real. Nothing accepted is ever lost by exterminating.
      const workerLease = await inspectLease(join(root, 'worker.lock')).catch(() => ({ held: true }));
      // A retained worker lease means its lifetime is uncertain. Never clean
      // beneath that writer; recovery will do so after proving it dead.
      if (!workerLease.held) {
        await resetTree(root, { worktree, baseRef, emit: () => {}, why: 'exterminate' })
          .catch(() => discardToHead(worktree).catch(() => {}));
      }
    }
    activity.idle('The supervisor has stopped.');
    await activity.close().catch(() => {});
    await heartbeat(root, { phase: 'stopped', iterations: summary.iterations, role: 'idle', model: null }).catch(() => {});
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
  // `state` may be minutes old by the time an escalation is raised. The
  // revision is re-read rather than trusted: an escalation that fails to land
  // because the operator typed something is the worst possible escalation to
  // lose.
  const fresh = await readProjectAgent(root).catch(() => state);
  const escalated = await escalateProjectAgent(root, fresh.revision, details).catch(error => {
    emit({ kind: 'escalation_failed', data: { reason: String(error.message ?? error) } });
    return null;
  });
  if (escalated) emit({ kind: 'escalation_raised', data: { kind: details.kind, reason: details.reason, taskId: details.taskId ?? null } });
  return escalated;
}

async function assertOperationActive(root, signal) {
  signal?.throwIfAborted();
  if ((await readProjectAgent(root)).exterminateRequested) throw new Error('exterminated by the operator');
  signal?.throwIfAborted();
}

async function handleReview({ root, state, task, runtime, worktree, baseRef, emit, activity, signal }) {
  const priorFindings = state.reviews.filter(review => review.taskId === task.id).flatMap(review => review.failed ?? []);
  let outcome;
  try {
    outcome = await reviewCheckpoint({
      runtime, worktree, task, baseRef,
      checkResults: task.evidence?.checks ?? [], workerSummary: task.evidence?.summary ?? '', priorFindings, emit, activity, signal,
    });
  } catch (error) {
    await assertOperationActive(root, signal);
    /*
     WHEN THE REVIEW RUNG CANNOT DO ITS JOB, THE WORKER TAKES THE TASK BACK.

     The gate never opens: nothing here accepts a checkpoint that was not
     reviewed. What changed is who handles a review that could not happen. It
     used to escalate — Nick woken for a reviewer that produced bad JSON twice,
     or for a check that failed on re-run. Neither needs him.

     A CHECK DISAGREEMENT means the checkpoint does not hold up: the worker
     reported green and the independent re-run is red. That is a failing
     checkpoint, which is the worker's to fix, so it goes straight back, told
     which checks failed. A flaky check exhausts the attempt budget and reaches
     Nick through the ordinary path — just not on the first occurrence.

     A REVIEWER THAT COULD NOT REVIEW — unusable output, a transport failure, a
     timeout — gets one more try. A second failure on the same checkpoint hands
     it back to the worker to make smaller and resubmit: the worker cannot
     approve its own work, but it can produce work the reviewer can judge.
    */
    const disagreed = error instanceof ReviewUnusable ? error.detail?.disagreed : null;
    const reason = String(error?.detail?.lastError ?? error?.message ?? error).slice(0, 400);
    if (disagreed) {
      const fresh = await readProjectAgent(root);
      await returnTaskToWorker(root, fresh.revision, task.id, { feedback:
        `Your checkpoint reported ${disagreed.join(', ')} as passing, but an independent re-run failed. ` +
        'Run the checks, fix what they actually report, and only then finish.' });
      emit({ kind: 'review_returned_to_worker', taskId: task.id, data: { why: 'check_disagreement', checks: disagreed } });
      return { accepted: false, progressed: true };
    }
    let failures = 1;
    try {
      const counted = await recordReviewFailure(root, (await readProjectAgent(root)).revision, task.id, reason);
      failures = counted.tasks.find(item => item.id === task.id)?.reviewFailures ?? 1;
    } catch { /* the checkpoint moved underneath the review; the next pass sees why */ }
    if (failures >= 2) {
      const latest = await readProjectAgent(root);
      await returnTaskToWorker(root, latest.revision, task.id, { feedback:
        `The reviewer could not complete a review of your last checkpoint (${reason}). ` +
        'Make the change smaller and more focused so it can be reviewed, then check and finish again.' });
      emit({ kind: 'review_returned_to_worker', taskId: task.id, data: { why: 'review_unavailable', failures, reason } });
      return { accepted: false, progressed: true };
    }
    // First failure. Unusable output: the next pass simply reviews again. A
    // runtime failure: runtime recovery decides whether to reload the model.
    if (error instanceof ReviewUnusable) return { accepted: false, progressed: true };
    throw error;
  }

  await assertOperationActive(root, signal);
  const { review } = outcome;
  const decision = review.verdict === 'PASS' ? 'accept'
    : review.verdict === 'PASS_WITH_TASKS' ? 'accept_with_tasks' : 'blocked';

  // A review takes minutes. Nick can pause or steer from the UI while it runs,
  // and that bumps the revision -- so applying the verdict against the revision
  // we started from would fail and escalate, waking him to report that he
  // touched the UI. Re-read, and confirm the checkpoint under review is still
  // the one on disk before applying anything.
  const fresh = await readProjectAgent(root);
  const current = fresh.tasks.find(item => item.id === task.id);
  if (!current || current.status !== 'awaiting_review' || current.commit !== task.commit) {
    emit({ kind: 'review_discarded', taskId: task.id, data: {
      reason: 'the checkpoint changed while the review was running', verdict: review.verdict } });
    return { accepted: false, progressed: true };
  }
  try {
    await reviewProjectTask(root, {
      revision: fresh.revision, taskId: task.id, commit: task.commit, decision,
      review: { ...review, reviewer: outcome.model },
    });
  } catch (error) {
    await assertOperationActive(root, signal);
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

async function handleRepair({ root, state, task, runtime, worktree, baseRef, emit, limits, activity, project = 'ORION',
  notifyRepair = notifyReviewerRepair, notifyStuck = notifyWorkerStuck, lastChecks = [], signal, checkpointRepair = commitRepair }) {
  const stuck = task.blocker === 'worker_stuck';
  const timedOut = task.blocker === 'worker_timeout';
  const history = stuck
    ? `The worker is STUCK: it kept working without writing anything new or fixing any check. ` +
      `It has made ${task.attempts} attempt(s) and ${task.corrections} correction cycle(s). ` +
      'Do not simply repeat its approach. Find what it has been unable to see, make the smallest ' +
      'correction that breaks the deadlock, and hand the rest back.'
    : timedOut
      ? `The worker ran out of time on this task (attempt ${task.attempts}). Its partial work is in the files ` +
        'you have been given. Work out what it was spending the time on, make the smallest correction that ' +
        'gets past it, and hand the rest back — do not attempt the whole task yourself.'
      : `The worker made ${task.attempts} attempt(s) and is blocked with "${task.blocker}". ` +
        `It has had ${task.corrections} correction cycle(s). The repair threshold is ${limits.repairAfterAttempts} attempts.`;
  // Nick asked to be told when it gets stuck, and then for the reviewer to try
  // to break it out. Informational tier: the loop has not stopped and nothing
  // is being asked of him, so it must not arrive looking like an escalation.
  if (stuck || timedOut) {
    await informIfAway(root, () => notifyStuck(root, { project, taskId: task.id, title: task.title,
      attempts: task.attempts, blocker: task.blocker }))
      .then(result => emit({ kind: 'stuck_notified', taskId: task.id, data: { delivered: result.delivered, reason: result.reason } }))
      .catch(() => {});
  }
  let repair;
  try {
    repair = await repairCheckpoint({ runtime, worktree, task, baseRef, checkResults: lastChecks, history, emit, activity,
      maxFiles: limits.repairMaxFiles, signal, beforeWrite: () => assertOperationActive(root, signal) });
  } catch (error) {
    await assertOperationActive(root, signal);
    /*
     THE REVIEWER COULD NOT REPAIR, SO THE WORKER CARRIES ON.

     A repair that fails outright — the model call timed out, the transport
     dropped — used to take the whole iteration down with it. It is not a
     judgement that the task needs a human (that is what the reviewer DECLINING
     means, below); it is the reviewer being unavailable. So the worker gets the
     further attempt it would have had after a repair, told plainly that no
     repair happened, and the used repair still counts against the bound so this
     cannot loop.
    */
    emit({ kind: 'repair_failed', taskId: task.id, data: { reason: String(error?.message ?? error).slice(0, 400) } });
    const current = await readProjectAgent(root);
    try {
      await grantRepairRetry(root, current.revision, task.id, {
        maxRepairs: limits.repairsPerTask, retryAttempts: limits.repairRetryAttempts,
        feedback: `The reviewer tried to help with this task but could not complete a repair ` +
          `(${String(error?.message ?? error).slice(0, 300)}). No changes were made on your behalf. ` +
          'Continue from the last checkpoint and take a different approach from your previous attempt.' });
    } catch (refused) {
      await escalate(root, await readProjectAgent(root), {
        kind: 'repeated_failure', taskId: task.id, recommendAstra: true,
        reason: `the reviewer could not repair ${task.id} and the worker has no attempts left: ${refused.message}`,
        question: 'Both local models are unable to make progress on this task.',
      }, emit);
    }
    return { progressed: true };
  }
  await assertOperationActive(root, signal);

  if (!repair.repaired) {
    await escalate(root, state, {
      kind: repair.escalate?.kind ?? 'judgement', taskId: task.id,
      reason: `bounded reviewer repair declined: ${repair.escalate?.reason ?? 'no reason given'}`,
      recommendAstra: true, question: 'The local ladder is exhausted for this task.',
    }, emit);
    return { progressed: true };
  }

  await assertOperationActive(root, signal);
  const committed = await checkpointRepair(worktree, task, repair);
  // Same reasoning as the review path: a repair takes minutes and the operator
  // may have moved the revision underneath it.
  const afterRepair = await readProjectAgent(root);
  await recordReviewerRepair(root, afterRepair.revision, {
    taskId: task.id, model: repair.model, files: repair.files,
    summary: `${repair.diagnosis} — ${repair.rationale}${repair.improved ? '' : ' (checks still failing after the repair)'}`,
    commit: committed.commit,
  });
  emit({ kind: 'reviewer_repair_committed', taskId: task.id, data: { files: repair.files, commit: committed.commit, improved: repair.improved } });
  // An already-started git commit must stay auditable if Exterminate arrived
  // while git finished. It does not authorize notifications or continuation.
  await assertOperationActive(root, signal);
  // Informational, not an escalation: nothing is blocked and nothing is being
  // asked of Nick. He asked to be told when the reviewer crosses into writing
  // code, and this is that -- one line, its own rate limit, no brief.
  await informIfAway(root, () => notifyRepair(root, { project, taskId: task.id, model: repair.model, files: repair.files,
    diagnosis: repair.diagnosis, improved: repair.improved, commit: committed.commit }))
    .then(result => emit({ kind: 'repair_notified', taskId: task.id, data: { delivered: result.delivered, reason: result.reason } }))
    .catch(() => {});

  /*
   The worker continues from the repair whether or not it made the checks pass.

   A repair that left checks failing used to escalate at once. Live, that was
   the most common 3am stop, and the repair had usually moved the task most of
   the way: the diagnosis plus a few more worker attempts is cheaper than a
   human, and the task is deferred only when those are spent too.
  */
  const after = await readProjectAgent(root);
  const failing = (repair.checks ?? []).filter(result => !result.ok).map(result => result.name ?? result.id).filter(Boolean);
  await grantRepairRetry(root, after.revision, task.id, {
    maxRepairs: limits.repairsPerTask, retryAttempts: limits.repairRetryAttempts,
    checkpoint: { commit: committed.commit, files: repair.files },
    feedback: `The reviewer made a repair to ${repair.files.join(', ')}: ${String(repair.diagnosis).slice(0, 600)}. ` +
      `${repair.remaining ? `It left this for you: ${String(repair.remaining).slice(0, 600)}. ` : ''}` +
      (repair.improved ? '' : `The checks still fail after the repair${failing.length ? ` (${failing.join(', ').slice(0, 300)})` : ''}; ` +
        'find what is still wrong rather than repeating the repair. ') +
      'Continue from that repair; do not undo it without a reason.' }).catch(async error => {
    emit({ kind: 'repair_retry_refused', taskId: task.id, data: { reason: String(error.message ?? error) } });
    if (!repair.improved) {
      await escalate(root, await readProjectAgent(root), {
        kind: 'repeated_failure', taskId: task.id, recommendAstra: true,
        reason: `the reviewer repaired ${repair.files.join(', ')} and the checks still fail`,
        question: 'Both local models have now failed on this task.',
      }, emit);
    }
  });
  return { progressed: true };
}

/**
 * Send an informational line only when Nick has said he is away. Asleep, the
 * journal already records it and the end-of-run digest summarises the outcome.
 */
async function informIfAway(root, send) {
  const state = await readProjectAgent(root).catch(() => null);
  if (state?.alertMode !== 'away') return { attempted: false, delivered: false, reason: 'quiet mode' };
  return send();
}

async function handleFinalReview({ root, state, runtime, worktree, baseRef, emit, activity, signal }) {
  let outcome;
  try {
    outcome = await reviewRun({ runtime, worktree, baseRef, tasks: state.tasks, reviews: state.reviews, emit, activity, signal });
    await assertOperationActive(root, signal);
  } catch (error) {
    await assertOperationActive(root, signal);
    throw error; // Bounded reviewer recovery runs before human escalation.
  }

  if (outcome.review.verdict === 'PASS') {
    const fresh = await readProjectAgent(root);
    try {
      await acceptProjectFinalReview(root, fresh.revision, { reviewer: outcome.model, summary: outcome.review.summary });
      emit({ kind: 'final_review_passed', data: { model: outcome.model, summary: outcome.review.summary } });
      return { progressed: true };
    } catch (error) {
      await assertOperationActive(root, signal);
      // The common case is an instruction that arrived after the last task was
      // handed to its worker, so it was never applied and closure refuses it.
      // That is a real question for a human -- apply it as new work, or dismiss
      // it -- and the loop has no authority to answer it either way.
      const unapplied = fresh.steering.filter(item => !item.applied).map(item => item.text);
      await escalate(root, fresh, {
        kind: 'pending_steering', recommendAstra: false,
        reason: `the run passed final review but cannot be closed: ${error.message}`,
        question: unapplied.length
          ? `These instructions arrived too late to be applied and would be silently lost: ${unapplied.join(' | ')}. ` +
            'Turn them into a task contract, or resolve the escalation to dismiss them.'
          : 'Closure was refused; see the reason above.',
      }, emit);
      return { progressed: true };
    }
  }
  /*
   PASS_WITH_TASKS at the end goes BACK TO THE WORKER, not to Nick.

   It is a local verdict (mission §4, corrected 2026-09-22): the corrections
   become ordinary tasks bounded by the RUN scope — the union of what a human
   already approved across the plan — and the loop reviews them like anything
   else. Escalating them inverted what the loop is for.

   What still escalates is a correction reaching outside that union, or past the
   correction depth. `applyFinalReviewCorrections` refuses both, and the refusal
   is what falls through to the escalation below.
  */
  if (outcome.review.verdict === 'PASS_WITH_TASKS') {
    const before = await readProjectAgent(root);
    try {
      await applyFinalReviewCorrections(root, before.revision, {
        reviewer: outcome.model, summary: outcome.review.summary, corrections: outcome.review.corrections ?? [],
      });
      emit({ kind: 'final_review_corrections_queued', data: {
        model: outcome.model, count: (outcome.review.corrections ?? []).length } });
      return { progressed: true };
    } catch (error) {
      await assertOperationActive(root, signal);
      emit({ kind: 'final_review_corrections_refused', data: { reason: String(error?.message ?? error) } });
      await escalate(root, await readProjectAgent(root), {
        kind: 'final_review_corrections', recommendAstra: true,
        reason: `the final review's corrections could not be returned to the worker: ${error?.message ?? error}`,
        question: `The review wants ${(outcome.review.corrections ?? []).length} cross-cutting correction(s): ` +
          `${(outcome.review.corrections ?? []).map(item => item.title).join('; ')}. ` +
          'They reach outside the scope this run was approved for, so they need you.',
      }, emit);
      return { progressed: true };
    }
  }

  // Only BLOCKED reaches here: the contract schema permits corrections solely
  // with PASS_WITH_TASKS, which returned above.
  await escalate(root, state, {
    kind: outcome.review.escalationKind ?? 'judgement',
    recommendAstra: true,
    reason: outcome.review.escalationReason || outcome.review.summary,
    question: 'Every task passed its own review and the combined run did not. That is the ' +
      'cross-cutting judgement the local loop is not allowed to make.',
  }, emit);
  return { progressed: true };
}

/** Make the run directory before anything writes into it. */
export async function ensureRunRoot(root) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  return root;
}
