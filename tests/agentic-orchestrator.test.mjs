import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  acceptProjectFinalReview, escalateProjectAgent, grantRepairRetry, initializeProjectAgent,
  markEscalationNotified, projectAgentProgress, readProjectAgent, reconcileInterruptedRun,
  recordReviewerRepair, resolveProjectEscalation, reviewProjectTask, runProjectAgent, setTaskSubtask,
} from '../scripts/lib/orion-project-agent.mjs';
import { auditJournal, readJournal } from '../scripts/lib/agentic/journal.mjs';
import { acquireLease, inspectLease, LeaseHeldError, ownerIsProvablyDead } from '../scripts/lib/agentic/lease.mjs';

const sha = character => character.repeat(40);
const tasks = () => [
  { id: 'task-one', title: 'First', objective: 'Build the first thing', weight: 2, dependencies: [],
    scope: ['sandbox/one.mjs'], checks: ['node-syntax'], acceptance: ['one exists'], nonScope: ['do not touch two'] },
  { id: 'task-two', title: 'Second', objective: 'Build the second thing', weight: 1, dependencies: ['task-one'],
    scope: ['sandbox/two.mjs'], checks: ['node-syntax'], acceptance: ['two exists'] },
];

async function fixture(t, options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'orion-agentic-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initializeProjectAgent(root, tasks(), options);
  return root;
}

const host = (overrides = {}) => ({
  durationMs: 10_000,
  worker: async () => ({ commit: sha('a'), summary: 'did the thing', files: ['sandbox/one.mjs'], checks: [{ name: 'node-syntax', ok: true, ms: 5 }] }),
  verify: async () => true,
  ...overrides,
});

test('a verified checkpoint carries the evidence the reviewer must judge on', async t => {
  const root = await fixture(t);
  const state = await runProjectAgent(root, host());
  const task = state.tasks[0];
  assert.equal(task.status, 'awaiting_review');
  assert.equal(task.evidence.summary, 'did the thing');
  assert.deepEqual(task.evidence.checks, [{ name: 'node-syntax', ok: true, ms: 5, exitCode: null }]);
  // Evidence is cleared the moment the task stops awaiting review, so a later
  // attempt can never be reviewed against an earlier attempt's check results.
  const accepted = await reviewProjectTask(root, { revision: state.revision, taskId: 'task-one', commit: sha('a'), decision: 'accept' });
  assert.equal(accepted.tasks[0].evidence, null);
});

test('PASS_WITH_TASKS accepts the work and returns corrections as real tasks', async t => {
  const root = await fixture(t);
  let state = await runProjectAgent(root, host());
  state = await reviewProjectTask(root, {
    revision: state.revision, taskId: 'task-one', commit: sha('a'), decision: 'accept_with_tasks',
    review: {
      verdict: 'PASS_WITH_TASKS', reviewer: 'test-reviewer', summary: 'sound, two fixes remain',
      corrections: [
        { title: 'Handle the empty case', objective: 'empty input returns []', acceptance: ['empty input returns []'] },
        { title: 'Name the error', objective: 'the thrown error names the file', acceptance: ['the error names the file'] },
      ],
    },
  });
  assert.equal(state.tasks[0].status, 'accepted');
  const added = state.tasks.filter(task => task.origin === 'review_correction');
  assert.equal(added.length, 2);
  assert.deepEqual(added.map(task => task.id), ['task-one-fix1-1', 'task-one-fix1-2']);
  for (const task of added) {
    assert.deepEqual(task.dependencies, ['task-one'], 'a correction depends on the work it corrects');
    assert.deepEqual(task.scope, ['sandbox/one.mjs'], 'a correction inherits the parent scope');
    assert.equal(task.correctionDepth, 1);
    assert.equal(task.status, 'queued');
  }
  assert.equal(state.reviews[0].correctionIds.length, 2);
  // Progress is honest about scope growth rather than hiding it.
  const progress = projectAgentProgress(state);
  assert.equal(progress.correctionTasks, 2);
  assert.ok(progress.scopeGrowth > 0);
});

test('a review cannot widen scope through a correction', async t => {
  const root = await fixture(t);
  const state = await runProjectAgent(root, host());
  await assert.rejects(reviewProjectTask(root, {
    revision: state.revision, taskId: 'task-one', commit: sha('a'), decision: 'accept_with_tasks',
    review: { verdict: 'PASS_WITH_TASKS', corrections: [
      { title: 'Also fix the other file', objective: 'x', acceptance: ['x'], scope: ['sandbox/elsewhere.mjs'] },
    ] },
  }), /outside the parent task's approved scope/);
  assert.equal((await readProjectAgent(root)).tasks[0].status, 'awaiting_review', 'nothing advanced');
});

test('correction depth is bounded, so scope cannot grow forever', async t => {
  const root = await fixture(t, { maxCorrectionDepth: 1 });
  let state = await runProjectAgent(root, host());
  state = await reviewProjectTask(root, {
    revision: state.revision, taskId: 'task-one', commit: sha('a'), decision: 'accept_with_tasks',
    review: { verdict: 'PASS_WITH_TASKS', corrections: [{ title: 'Fix', objective: 'x', acceptance: ['x'] }] },
  });
  // The depth-1 correction now runs; a correction OF that correction would be
  // depth 2, past the limit, and must refuse rather than nest indefinitely.
  state = await runProjectAgent(root, host());
  assert.equal(state.activeTask, null);
  const fix = state.tasks.find(task => task.id === 'task-one-fix1-1');
  assert.equal(fix.status, 'awaiting_review');
  await assert.rejects(reviewProjectTask(root, {
    revision: state.revision, taskId: fix.id, commit: sha('a'), decision: 'accept_with_tasks',
    review: { verdict: 'PASS_WITH_TASKS', corrections: [{ title: 'Fix the fix', objective: 'y', acceptance: ['y'] }] },
  }), /exceeds the limit/);
});

test('a review of a different contract version is refused', async t => {
  const root = await fixture(t);
  const state = await runProjectAgent(root, host());
  await assert.rejects(reviewProjectTask(root, {
    revision: state.revision, taskId: 'task-one', commit: sha('a'), decision: 'accept',
    review: { verdict: 'PASS', contractDigest: 'a-digest-from-some-other-contract' },
  }), /examined a different version of the contract/);
});

test('reviewer-authored code is recorded separately from reviews', async t => {
  const root = await fixture(t);
  let state = await runProjectAgent(root, host());
  state = await recordReviewerRepair(root, state.revision, {
    taskId: 'task-one', model: 'reviewer-model', files: ['sandbox/one.mjs'],
    summary: 'fixed the interface the worker kept mishandling', commit: sha('b'),
  });
  assert.equal(state.repairs.length, 1);
  assert.equal(state.reviews.length, 0, 'a repair is not a review');
  assert.equal(state.repairs[0].model, 'reviewer-model');
  const journal = await readJournal(root, { kinds: ['reviewer_repair'] });
  assert.equal(journal.length, 1, 'the crossing from reviewing into implementing is journalled');
});

test('a repair grants exactly one more attempt, not a fresh budget', async t => {
  const root = await fixture(t, { maxAttempts: 2 });
  // Burn both attempts with failing work.
  for (let i = 0; i < 2; i++) {
    const state = await runProjectAgent(root, host());
    await reviewProjectTask(root, { revision: state.revision, taskId: 'task-one', commit: sha('a'), decision: 'changes_requested' });
  }
  let state = await readProjectAgent(root);
  assert.equal(state.tasks[0].status, 'blocked');
  assert.equal(state.tasks[0].attempts, 2);

  state = await grantRepairRetry(root, state.revision, 'task-one');
  assert.equal(state.tasks[0].status, 'queued');
  assert.equal(state.tasks[0].attempts, 1, 'one attempt remains, not two');
  assert.equal(state.tasks[0].repairsUsed, 1);

  // A second repair on the same task is refused: the ladder has one local rung.
  const after = await runProjectAgent(root, host());
  await reviewProjectTask(root, { revision: after.revision, taskId: 'task-one', commit: sha('a'), decision: 'changes_requested' });
  const blocked = await readProjectAgent(root);
  await assert.rejects(grantRepairRetry(root, blocked.revision, 'task-one'), /already used its 1 repair/);
});

test('a task-level escalation parks ONE task and the run keeps going', async t => {
  const root = await fixture(t);
  let state = await readProjectAgent(root);
  // task-one is escalated. task-two depends on it, so nothing else is claimable
  // here — the continuity property is proven in the dedicated test below.
  state = await escalateProjectAgent(root, state.revision, {
    kind: 'architecture', reason: 'two defensible designs', taskId: 'task-one',
    question: 'Which shape do you want?', recommendAstra: true,
  });
  assert.equal(state.escalations.length, 1);
  assert.equal(state.escalations[0].notified, false);
  // Parked, not blocked: it never ran, so it has zero attempts, and a blocked
  // task with zero attempts would violate the lifecycle invariant. Parking is
  // enforced by the claim filter, not by the task's own status.
  assert.equal(state.tasks[0].status, 'queued');
  assert.equal(state.tasks[0].attempts, 0);

  // Nothing else can run (task-two depends on task-one), so the run IS stuck.
  const after = await runProjectAgent(root, host());
  assert.equal(after.status, 'escalated');
  assert.equal(after.activeTask, null);

  state = await markEscalationNotified(root, after.revision, after.escalations[0].id);
  assert.equal(state.escalations[0].notified, true);

  // Only an explicit human resolution moves it, and it names the escalation.
  state = await resolveProjectEscalation(root, state.revision, state.escalations[0].id, 'chose the second design');
  assert.equal(state.escalations[0].resolvedAt !== null, true);
  assert.equal(state.tasks[0].status, 'queued', 'the task is claimable again');
  assert.equal(state.status, 'ready');
});

test('one blocked task does not stop work that is still possible', async t => {
  // THE continuity property. An earlier design made escalation run-level, so a
  // single hard problem ended the night even when independent tasks remained.
  const root = await mkdtemp(join(tmpdir(), 'orion-agentic-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initializeProjectAgent(root, [
    { id: 'hard-one', title: 'The ambiguous one', objective: 'x', weight: 1, dependencies: [],
      scope: ['sandbox/a.mjs'], checks: ['node-syntax'], acceptance: ['a'] },
    { id: 'easy-two', title: 'Independent work', objective: 'y', weight: 1, dependencies: [],
      scope: ['sandbox/b.mjs'], checks: ['node-syntax'], acceptance: ['b'] },
    { id: 'easy-three', title: 'More independent work', objective: 'z', weight: 1, dependencies: [],
      scope: ['sandbox/c.mjs'], checks: ['node-syntax'], acceptance: ['c'] },
  ]);

  let state = await readProjectAgent(root);
  state = await escalateProjectAgent(root, state.revision, {
    kind: 'architecture', reason: 'needs a human', taskId: 'hard-one', recommendAstra: true,
  });
  assert.equal(state.status, 'ready', 'still ready — two independent tasks remain');

  // The loop picks up the others and never touches the parked one.
  for (const expected of ['easy-two', 'easy-three']) {
    state = await runProjectAgent(root, host());
    assert.equal(state.activeTask, null);
    const running = state.tasks.find(task => task.id === expected);
    assert.equal(running.status, 'awaiting_review', `${expected} ran`);
    await reviewProjectTask(root, { revision: state.revision, taskId: expected, commit: sha('a'), decision: 'accept' });
  }
  state = await readProjectAgent(root);
  const parked = state.tasks.find(task => task.id === 'hard-one');
  assert.equal(parked.attempts, 0, 'the escalated task was never claimed');
  assert.equal(parked.status, 'queued', 'parked by the escalation, not by having failed');
  assert.equal(state.tasks.filter(task => task.status === 'accepted').length, 2);
  // Only NOW, with nothing left to do, is the run genuinely stopped.
  assert.equal(state.status, 'escalated');
});

test('a RUN-level escalation stops everything immediately', async t => {
  const root = await fixture(t);
  let state = await readProjectAgent(root);
  state = await escalateProjectAgent(root, state.revision, {
    kind: 'contradiction', reason: 'the whole plan is unsatisfiable', taskId: null,
  });
  assert.equal(state.status, 'escalated');
  const after = await runProjectAgent(root, host());
  assert.equal(after.status, 'escalated');
  assert.equal(after.tasks.every(task => task.status === 'queued'), true, 'nothing was claimed');
});

test('a run cannot be closed while an escalation is open', async t => {
  const root = await fixture(t);
  for (const id of ['task-one', 'task-two']) {
    const state = await runProjectAgent(root, host());
    await reviewProjectTask(root, { revision: state.revision, taskId: id, commit: sha('a'), decision: 'accept' });
  }
  let state = await readProjectAgent(root);
  state = await escalateProjectAgent(root, state.revision, { kind: 'judgement', reason: 'needs a look' });
  await assert.rejects(acceptProjectFinalReview(root, state.revision), /resolve every open escalation/);
  state = await resolveProjectEscalation(root, state.revision, state.escalations[0].id, 'looked');
  state = await acceptProjectFinalReview(root, state.revision, { reviewer: 'test', summary: 'coherent' });
  assert.equal(state.status, 'completed');
  assert.equal(projectAgentProgress(state).percent, 100);
});

test('an interrupted run needs PROOF the worker is dead before it moves', async t => {
  const root = await fixture(t);
  let finish;
  const state = await runProjectAgent(root, host({
    taskTimeoutMs: 20, worker: () => new Promise(resolve => { finish = resolve; }),
  }));
  assert.equal(state.status, 'interrupted');

  for (const bad of [undefined, {}, { dead: false, reason: 'still alive' }, { dead: true }]) {
    await assert.rejects(reconcileInterruptedRun(root, state.revision, { deadOwnerProof: bad }),
      /requires proof/, 'a reconciliation without proof must refuse');
  }
  const reconciled = await reconcileInterruptedRun(root, state.revision, {
    deadOwnerProof: { dead: true, reason: 'pid 999999 is not present on this boot' },
  });
  // Not 'ready': the reconciled task is blocked and task-two depends on it, so
  // nothing is claimable. Reporting 'ready' with nothing to claim was the lie
  // `settleStatus` exists to prevent.
  assert.equal(reconciled.status, 'waiting_for_review');
  assert.equal(reconciled.tasks[0].status, 'blocked');
  assert.equal(reconciled.tasks[0].blocker, 'worker_outcome_unknown');
  // The proof is recorded, not merely checked.
  const journal = await readJournal(root, { kinds: ['reconciled'] });
  assert.match(JSON.stringify(journal), /pid 999999/);
  finish({ commit: sha('a') });
});

test('the journal is contiguous on the control stream and gaps are reported', async t => {
  const root = await fixture(t);
  const state = await runProjectAgent(root, host());
  await reviewProjectTask(root, { revision: state.revision, taskId: 'task-one', commit: sha('a'), decision: 'accept' });
  const audit = await auditJournal(root);
  assert.equal(audit.gaps.length, 0);
  assert.equal(audit.corrupt.length, 0);
  assert.ok(audit.control >= 4, 'initialize, task_started, review_requested and review are all recorded');
  assert.equal(audit.firstSeq, 1);
});

test('a lease is only reclaimed on proof, and a live holder is never displaced', async t => {
  const root = await mkdtemp(join(tmpdir(), 'orion-lease-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'worker.lock');

  await acquireLease(path, { extra: { role: 'test' } });
  // This very process holds it; a second acquire must refuse.
  await assert.rejects(acquireLease(path), LeaseHeldError);
  const held = await inspectLease(path);
  assert.equal(held.held, true);
  assert.equal(held.dead, false);

  // A holder from a previous boot is provably gone.
  assert.equal(ownerIsProvablyDead({ pid: process.pid, bootId: 'some-earlier-boot', startedAt: 'x' }).dead, true);
  // A pid that is not present is provably gone.
  assert.equal(ownerIsProvablyDead({ pid: 999_999, bootId: (await inspectLease(path)).owner.bootId, startedAt: 'x' }).dead, true);
  // No owner record at all is NOT proof; it must stay held.
  assert.equal(ownerIsProvablyDead(null).dead, false);
  assert.equal(ownerIsProvablyDead({ bootId: 'x' }).dead, false);

  await writeFile(join(path, 'owner.json'), JSON.stringify({ pid: 999_999, bootId: 'an-old-boot', startedAt: 'then' }));
  const reclaimed = await acquireLease(path);
  assert.equal(reclaimed.reclaimed, true);
  assert.match(reclaimed.reason, /previous boot/);
});

test('a lease directory with no owner record is never cleared automatically', async t => {
  const root = await mkdtemp(join(tmpdir(), 'orion-lease-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, 'worker.lock');
  // A crash between `mkdir` and writing the owner record leaves exactly this.
  await mkdir(path);
  await assert.rejects(acquireLease(path), error => {
    assert.match(error.message, /carries no owner record/);
    return true;
  });
});

test('the runtime owns the current subtask, and it never survives the task', async t => {
  const root = await fixture(t);
  // Recorded mid-task, from inside the worker, so the panel shows where the
  // work is rather than a model having to remember it.
  const adapter = host({
    worker: async task => {
      await setTaskSubtask(root, task.id, { label: 'reading the store', index: 1, total: 3 });
      let live = await readProjectAgent(root);
      assert.equal(live.tasks[0].subtask.label, 'reading the store');
      assert.equal(live.tasks[0].subtask.total, 3);

      await setTaskSubtask(root, task.id, { label: 'writing the change', index: 2, total: 3 });
      live = await readProjectAgent(root);
      assert.equal(live.tasks[0].subtask.index, 2);
      return { commit: sha('a'), summary: 'done', files: ['sandbox/one.mjs'], checks: [{ name: 'node-syntax', ok: true, ms: 1 }] };
    },
  });

  let state = await runProjectAgent(root, adapter);
  assert.equal(state.tasks[0].status, 'awaiting_review');

  // Cleared when the task leaves the worker's hands: a stale "2/3 writing the
  // change" next to an accepted task is a panel lying about the present.
  state = await reviewProjectTask(root, { revision: state.revision, taskId: 'task-one', commit: sha('a'), decision: 'accept' });
  assert.equal(state.tasks[0].subtask, null);

  // It is a label, not authority: a subtask claiming completion changes nothing.
  const other = await readProjectAgent(root);
  await setTaskSubtask(root, 'task-two', { label: '3/3 finished', index: 3, total: 3 });
  assert.equal((await readProjectAgent(root)).tasks[1].subtask, null,
    'a task that is not running has no subtask to set');
  assert.equal(other.tasks[1].status, 'queued');
});
