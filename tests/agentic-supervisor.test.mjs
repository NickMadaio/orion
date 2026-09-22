/*
 End-to-end supervisor tests against a REAL git repository and REAL checks.

 The model is the only thing faked. Everything else — the worktree, the commits,
 `node --check`, the boundary, the leases, the journal — is the production code
 path, because the failures this system has to survive are filesystem and
 process failures, and a mocked filesystem proves nothing about them.

 The escalation notifier is injected and never the real one: Discord alerts are
 LIVE on this machine, and a suite that sent one would wake Nick to tell him a
 test passed.
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initializeProjectAgent, readProjectAgent, steerProjectAgent } from '../scripts/lib/orion-project-agent.mjs';
import { superviseRun, recoverRun } from '../scripts/lib/agentic/supervisor.mjs';
import { acquireLease } from '../scripts/lib/agentic/lease.mjs';
import { readJournal } from '../scripts/lib/agentic/journal.mjs';
import { ActivityChannel, readActivity } from '../scripts/lib/agentic/activity.mjs';
import { DEFAULT_CONFIG } from '../scripts/lib/agentic/models.mjs';
import { changedFiles, currentHead } from '../scripts/lib/agentic/workspace.mjs';

const git = (cwd, ...argv) => execFileSync('/usr/bin/git', argv, {
  cwd, encoding: 'utf8',
  env: { PATH: '/usr/bin:/bin', HOME: process.env.HOME ?? '', GIT_CONFIG_NOSYSTEM: '1',
    GIT_AUTHOR_NAME: 'T', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 'T', GIT_COMMITTER_EMAIL: 't@t' },
});

async function repository(t) {
  const root = await mkdtemp(join(tmpdir(), 'orion-supervisor-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const worktree = join(root, 'repo');
  await mkdir(join(worktree, 'sandbox'), { recursive: true });
  await writeFile(join(worktree, 'sandbox/widget.mjs'), 'export const version = 1;\n');
  git(worktree, 'init', '-q', '-b', 'main');
  git(worktree, 'add', '.');
  git(worktree, '-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-qm', 'base');
  return { root: join(root, 'state'), worktree, baseRef: git(worktree, 'rev-parse', 'HEAD').trim() };
}

const plan = () => [{
  id: 'bump-version', title: 'Bump the widget version', objective: 'version is 2',
  weight: 1, dependencies: [], scope: ['sandbox/widget.mjs'], checks: ['node-syntax'],
  acceptance: ['sandbox/widget.mjs exports version 2'],
}];

/** A scripted stand-in for `ModelRuntime`. Roles, not model names, exactly as production. */
class FakeRuntime {
  constructor(script) { this.script = script; this.calls = []; this.released = false; }
  async probe() { return { endpoint: 'fake', installed: ['fake'], roles: { worker: 'fake-worker', reviewer: 'fake-reviewer' } }; }
  async releaseAll() { this.released = true; }
  async generate(role, { prompt }) {
    this.calls.push({ role, prompt });
    const queue = this.script[role] ?? [];
    const next = queue.length > 1 ? queue.shift() : (queue[0] ?? '');
    return {
      role, model: `fake-${role}`, ms: 1, handoff: { evicted: [], resident: role },
      text: typeof next === 'function' ? await next(prompt) : next,
      meta: { thinkingChars: 0, doneReason: 'stop', evalCount: 1, promptEvalCount: 1 },
    };
  }
}

const writeThenDone = contents => [
  `Reasoning first.\n### FILE: sandbox/widget.mjs\n\`\`\`javascript\n${contents}\n\`\`\`\n### CHECK`,
  '### DONE\nBumped the version to 2 as the objective required.',
];

const passReview = '```json\n{"verdict":"PASS","summary":"meets the contract","examined":["sandbox/widget.mjs"],"passed":["version is 2"],"failed":[]}\n```';

const config = () => ({ ...DEFAULT_CONFIG, limits: { ...DEFAULT_CONFIG.limits, taskTimeoutMs: 20_000, iterationStallLimit: 3 } });
const silentNotify = async () => ({ attempted: false, delivered: false, reason: 'test', results: [] });
const silentRepairNotify = async () => ({ attempted: false, delivered: false, reason: 'test' });

test('a task is implemented, checked, committed, reviewed and closed without a human', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({
    worker: writeThenDone('export const version = 2;'),
    reviewer: [passReview, passReview],
  });

  const result = await superviseRun(root, {
    worktree, baseRef, runtime, config: config(), durationMs: 60_000, notify: silentNotify, notifyRepair: silentRepairNotify,
  });

  assert.equal(result.state.status, 'completed');
  assert.equal(result.tasksAccepted, 1);
  assert.equal(result.state.tasks[0].status, 'accepted');
  assert.equal(result.state.finalReview, true);

  // The change is really on disk and really committed.
  assert.match(await readFile(join(worktree, 'sandbox/widget.mjs'), 'utf8'), /version = 2/);
  assert.equal((await changedFiles(worktree)).length, 0, 'the tree is left clean and resumable');
  assert.equal(await currentHead(worktree), result.state.tasks[0].commit);
  assert.match(git(worktree, 'log', '-1', '--format=%s'), /agent\(bump-version\)/);
  assert.equal(runtime.released, true, 'model memory is released at the end of a run');
});

test('a worker cannot report done while a check fails', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan(), { maxAttempts: 1 });
  const runtime = new FakeRuntime({
    // Deliberately unparseable JavaScript, then an immediate claim of success.
    worker: [
      '### FILE: sandbox/widget.mjs\n```javascript\nexport const version = ;;;\n```\n### CHECK',
      '### DONE\nIt is finished and everything passes.',
      '### DONE\nReally, it is finished.',
    ],
    reviewer: [passReview],
  });

  const result = await superviseRun(root, {
    worktree, baseRef, runtime, config: config(), durationMs: 30_000, notify: silentNotify, notifyRepair: silentRepairNotify,
  });

  const task = result.state.tasks[0];
  assert.notEqual(task.status, 'accepted', 'broken code must never be accepted');
  assert.equal(task.commit, null, 'no checkpoint is minted for failing work');
  // And nothing was committed: HEAD is still the base.
  assert.equal(await currentHead(worktree), baseRef);
});

test('a write outside the task scope is refused and the run continues', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await writeFile(join(worktree, 'sandbox/other.mjs'), 'export const other = 1;\n');
  git(worktree, 'add', '.');
  git(worktree, '-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-qm', 'other');
  const base = git(worktree, 'rev-parse', 'HEAD').trim();
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({
    worker: [
      '### FILE: sandbox/other.mjs\n```javascript\nexport const other = 99;\n```',
      ...writeThenDone('export const version = 2;'),
    ],
    reviewer: [passReview, passReview],
  });

  const result = await superviseRun(root, {
    worktree, baseRef: base, runtime, config: config(), durationMs: 60_000, notify: silentNotify, notifyRepair: silentRepairNotify,
  });

  assert.equal(result.state.tasks[0].status, 'accepted');
  assert.match(await readFile(join(worktree, 'sandbox/other.mjs'), 'utf8'), /other = 1/, 'the out-of-scope file is untouched');
  const refusals = await readJournal(root, { kinds: ['worker_write_refused'] });
  assert.equal(refusals.length, 1);
  assert.equal(refusals[0].layer, 'scope');
});

test('a BLOCKED review halts the run, escalates once, and alerts exactly one time', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const alerts = [];
  const runtime = new FakeRuntime({
    worker: writeThenDone('export const version = 2;'),
    reviewer: ['```json\n{"verdict":"BLOCKED","summary":"the objective is ambiguous","escalationReason":"two defensible designs and the contract picks neither","escalationKind":"architecture"}\n```'],
  });

  const result = await superviseRun(root, {
    worktree, baseRef, runtime, config: config(), durationMs: 60_000,
    notify: async state => {
      const open = state.escalations.filter(item => !item.resolvedAt);
      alerts.push(open);
      return { attempted: true, delivered: true, reason: null,
        results: open.map(item => ({ id: item.id, delivered: true, reason: null, briefPath: '/tmp/brief.md' })) };
    },
  });

  assert.equal(result.state.status, 'escalated');
  const open = result.state.escalations.filter(item => !item.resolvedAt);
  assert.equal(open.length, 1);
  assert.equal(open[0].kind, 'architecture');
  assert.equal(open[0].recommendAstra, true, 'an architecture block is an Astra question');
  assert.equal(open[0].notified, true);
  assert.equal(open[0].taskId, 'bump-version', 'task-level, so a bigger plan would carry on');
  assert.equal(alerts.length, 1, 'exactly one alert per escalation, not one per loop iteration');
  assert.equal(result.state.tasks[0].status, 'blocked');
});

test('a malformed review is never resolved as an accept', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({
    worker: writeThenDone('export const version = 2;'),
    // Prose only. The parser has nothing to act on.
    reviewer: ['Everything mostly looks fine to me, ship it.'],
  });

  const result = await superviseRun(root, {
    worktree, baseRef, runtime, config: config(), durationMs: 60_000, notify: silentNotify, notifyRepair: silentRepairNotify,
  });

  assert.equal(result.state.status, 'escalated');
  assert.notEqual(result.state.tasks[0].status, 'accepted', 'the gate failed closed');
  const open = result.state.escalations.filter(item => !item.resolvedAt);
  assert.match(open[0].reason, /could not produce a valid review/);
});

test('PASS_WITH_TASKS turns into real work the worker then does', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({
    worker: [
      ...writeThenDone('export const version = 2;'),
      `### FILE: sandbox/widget.mjs\n\`\`\`javascript\nexport const version = 2;\nexport const label = 'widget';\n\`\`\`\n### CHECK`,
      '### DONE\nAdded the label the review asked for.',
    ],
    reviewer: [
      '```json\n{"verdict":"PASS_WITH_TASKS","summary":"sound, one fix remains","examined":["sandbox/widget.mjs"],"passed":["version is 2"],"failed":[{"criterion":"the module should also export a label","severity":"minor","evidence":"no label export"}],"corrections":[{"title":"Export a label","objective":"the module exports label","acceptance":["label is exported"]}]}\n```',
      passReview, passReview, passReview,
    ],
  });

  const result = await superviseRun(root, {
    worktree, baseRef, runtime, config: config(), durationMs: 90_000, notify: silentNotify, notifyRepair: silentRepairNotify,
  });

  const correction = result.state.tasks.find(task => task.origin === 'review_correction');
  assert.ok(correction, 'the review produced a real task');
  assert.equal(correction.status, 'accepted');
  assert.match(await readFile(join(worktree, 'sandbox/widget.mjs'), 'utf8'), /label/);
  assert.equal(result.state.status, 'completed');
});

test('crash recovery discards a half-written mutation and reports it', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  // Exactly what a crash mid-write leaves behind: an edited file and an
  // untracked one, with no commit and no record that either happened.
  await writeFile(join(worktree, 'sandbox/widget.mjs'), 'export const version = "half-writ');
  await writeFile(join(worktree, 'sandbox/stray.mjs'), 'junk');

  const events = [];
  const recovery = await recoverRun(root, { worktree, emit: event => events.push(event) });
  assert.equal(recovery.head, baseRef);
  assert.equal((await changedFiles(worktree)).length, 0);
  assert.match(await readFile(join(worktree, 'sandbox/widget.mjs'), 'utf8'), /version = 1/);
  const discarded = events.find(event => event.kind === 'partial_work_discarded');
  assert.ok(discarded, 'discarding work is never silent');
  assert.ok(discarded.data.files.includes('sandbox/widget.mjs'));
});

test('recovery refuses to start a second writer while a live worker holds the lease', async t => {
  const { root, worktree } = await repository(t);
  await initializeProjectAgent(root, plan());
  // Held by THIS process, which is provably alive.
  await acquireLease(join(root, 'worker.lock'), { extra: { role: 'worker' } });
  await assert.rejects(recoverRun(root, { worktree, emit: () => {} }),
    /Refusing to start a second writer/);
});

test('two supervisors cannot run against one project', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  await acquireLease(join(root, 'supervisor.lock'), { extra: { role: 'supervisor' } });
  await assert.rejects(superviseRun(root, {
    worktree, baseRef, runtime: new FakeRuntime({}), config: config(), durationMs: 5_000, notify: silentNotify, notifyRepair: silentRepairNotify,
  }), /lease .* is held/);
});

test('the watchdog stops a loop that is not making progress', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan(), { maxAttempts: 1 });
  const runtime = new FakeRuntime({
    // Never a marker, forever. The worker burns its turns, the task blocks, and
    // the loop has nothing left to do; the watchdog must end it rather than
    // spinning until the budget runs out.
    worker: ['I am thinking about it.'],
    reviewer: [passReview],
  });
  const result = await superviseRun(root, {
    worktree, baseRef, runtime, config: config(), durationMs: 120_000, notify: silentNotify, notifyRepair: silentRepairNotify,
  });
  assert.equal(result.state.status, 'escalated');
  assert.ok(result.iterations < 20, `the loop should stop quickly, ran ${result.iterations} iterations`);
});

test('a heartbeat distinguishes a busy supervisor from a crashed one', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  await superviseRun(root, {
    worktree, baseRef, runtime: new FakeRuntime({ worker: writeThenDone('export const version = 2;'), reviewer: [passReview, passReview] }),
    config: config(), durationMs: 60_000, notify: silentNotify, notifyRepair: silentRepairNotify,
  });
  const beat = JSON.parse(await readFile(join(root, 'heartbeat.json'), 'utf8'));
  assert.equal(beat.phase, 'stopped', 'the final heartbeat says the supervisor is gone');
  assert.ok(beat.pid > 0 && beat.bootId, 'the heartbeat carries provable ownership');
});

test('an operator instruction during a review does not corrupt the review', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  // A review takes minutes in production. Nick steering from the UI during one
  // bumps the revision, and a verdict applied against the revision the loop
  // started from would fail — escalating to tell him he touched the UI.
  let steered = false;
  const runtime = new FakeRuntime({
    worker: writeThenDone('export const version = 2;'),
    reviewer: [async () => {
      if (!steered) {
        steered = true;
        const state = await readProjectAgent(root);
        await steerProjectAgent(root, 'steer', state.revision, 'keep the public interface stable');
      }
      return passReview;
    }, passReview],
  });

  const result = await superviseRun(root, {
    worktree, baseRef, runtime, config: config(), durationMs: 90_000, notify: silentNotify, notifyRepair: silentRepairNotify,
  });

  assert.equal(steered, true, 'the race was actually exercised');
  assert.equal(result.state.tasks[0].status, 'accepted', 'the review still applied to the right checkpoint');

  // An instruction that arrives after the last task was handed to its worker is
  // never applied, and closure refuses to discard it silently. That stop is
  // CORRECT — but it must be the honest "your instruction arrived too late"
  // one, not "the reviewer's verdict could not be applied", and it must not
  // kill the supervisor.
  const open = result.state.escalations.filter(item => !item.resolvedAt);
  if (open.length) {
    assert.equal(open[0].kind, 'pending_steering');
    assert.match(open[0].question, /keep the public interface stable/);
    assert.equal(open[0].recommendAstra, false, 'this needs Nick, not Astra');
  } else {
    assert.equal(result.state.status, 'completed');
  }
  assert.ok(result.iterations > 0);
});

test('a throwing iteration does not kill an unattended supervisor', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  // An unattended process that dies on an exception has told nobody. The loop
  // must survive, count the failure, and let the watchdog end the run with an
  // escalation Nick hears about.
  const runtime = new FakeRuntime({ worker: writeThenDone('export const version = 2;'), reviewer: [passReview] });
  const exploding = {
    probe: () => runtime.probe(),
    releaseAll: () => runtime.releaseAll(),
    generate: async () => { throw new Error('inference runtime fell over'); },
  };

  const result = await superviseRun(root, {
    worktree, baseRef, runtime: exploding, config: config(), durationMs: 60_000, notify: silentNotify, notifyRepair: silentRepairNotify,
  });

  assert.ok(result.state, 'the supervisor returned a summary instead of throwing');
  assert.equal(result.state.status, 'escalated');
  const open = result.state.escalations.filter(item => !item.resolvedAt);
  assert.match(open[0].reason, /failed 3 times in a row|worker_or_validation_failed|blocked|no remaining move/);
  assert.ok(result.iterations <= 12, `should stop quickly, ran ${result.iterations}`);
});

test('the live channel always lands its final state, however fast tokens arrive', async t => {
  const root = await mkdtemp(join(tmpdir(), 'orion-activity-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const channel = new ActivityChannel(root);

  channel.begin({ role: 'worker', model: 'test-model', phase: 'implement', taskId: 'task-one', note: 'working' });
  // Faster than the throttle, which is the case that broke it: `end()` used to
  // be dropped when it arrived during an in-flight write, leaving a finished
  // generation whose panel said "thinking" forever.
  for (let i = 0; i < 200; i++) channel.delta({ thinking: `step ${i} ` });
  for (let i = 0; i < 40; i++) channel.delta({ response: `out${i} ` });
  await channel.end('done');

  const after = await readActivity(root);
  assert.equal(after.thinking, false, 'a finished generation must never still read as thinking');
  assert.equal(after.streaming, false);
  assert.equal(after.note, 'done');
  assert.ok(after.thinkingChars > 1000, 'the full trace length is counted');
  assert.ok(after.outputChars > 0);
  // The tail is kept, not the head: where the reasoning got to is what a reader
  // wants, and the buffer is bounded so a long run cannot grow it without limit.
  assert.ok(after.trace.length <= 6000);
  assert.match(after.trace, /step 199/);

  await channel.idle('stopped');
  const idle = await readActivity(root);
  assert.equal(idle.role, 'idle');
  assert.equal(idle.trace, '', 'idle clears the trace rather than leaving a stale one on screen');
  await channel.close();
});

test('a run publishes what the model is thinking while it thinks', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const seen = [];
  const streaming = {
    probe: async () => ({ endpoint: 'fake', installed: [], roles: {} }),
    releaseAll: async () => {},
    spec: role => ({ model: `fake-${role}` }),
    async generate(role, { onDelta }) {
      // Emit thinking, then read the channel back mid-generation: the panel has
      // to be truthful DURING the call, not only after it.
      await onDelta?.({ thinking: 'considering the contract ' });
      seen.push(await readActivity(root));
      const queue = role === 'worker' ? workerScript : [passReview];
      const next = queue.length > 1 ? queue.shift() : queue[0];
      onDelta?.({ response: next });
      return { role, model: `fake-${role}`, ms: 1, text: next, thinking: 'considering the contract ',
        handoff: { evicted: [], resident: role }, meta: { thinkingChars: 24, doneReason: 'stop' } };
    },
  };
  const workerScript = [...writeThenDone('export const version = 2;')];

  await superviseRun(root, {
    worktree, baseRef, runtime: streaming, config: config(), durationMs: 60_000, notify: silentNotify, notifyRepair: silentRepairNotify,
  });

  const live = seen.find(entry => entry?.thinking);
  assert.ok(live, 'the channel reported thinking while a generation was in flight');
  assert.match(live.trace, /considering the contract/);
  assert.ok(['worker', 'reviewer'].includes(live.role));
  assert.equal(live.streaming, true);

  const final = await readActivity(root);
  assert.equal(final.thinking, false, 'a stopped supervisor never leaves a thinking indicator on');
  assert.equal(final.role, 'idle');
});

test('a BLOCKED review parks one task and the supervisor keeps working', async t => {
  // THE continuity property, end to end. Nick: "make sure this loop is able to
  // be continuous. If one part is stopped see what else can be done." An
  // earlier design stopped the entire run at the first BLOCKED review, so a
  // single ambiguous contract ended the night with hours of capacity unused.
  const { root, worktree, baseRef } = await repository(t);
  await mkdir(join(worktree, 'sandbox'), { recursive: true });
  await writeFile(join(worktree, 'sandbox/second.mjs'), 'export const second = 1;\n');
  git(worktree, 'add', '.');
  git(worktree, '-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-qm', 'second');
  const base = git(worktree, 'rev-parse', 'HEAD').trim();

  await initializeProjectAgent(root, [
    { id: 'ambiguous-one', title: 'The hard one', objective: 'version is 2', weight: 1, dependencies: [],
      scope: ['sandbox/widget.mjs'], checks: ['node-syntax'], acceptance: ['widget version 2'] },
    { id: 'independent-two', title: 'Unrelated work', objective: 'second is 2', weight: 1, dependencies: [],
      scope: ['sandbox/second.mjs'], checks: ['node-syntax'], acceptance: ['second is 2'] },
  ]);

  const blocked = '```json\n{"verdict":"BLOCKED","summary":"ambiguous","escalationReason":"two defensible designs","escalationKind":"architecture"}\n```';
  const runtime = new FakeRuntime({
    worker: [
      'Reasoning.\n### FILE: sandbox/widget.mjs\n```javascript\nexport const version = 2;\n```\n### CHECK',
      '### DONE\nBumped the widget.',
      'Reasoning.\n### FILE: sandbox/second.mjs\n```javascript\nexport const second = 2;\n```\n### CHECK',
      '### DONE\nBumped second.',
    ],
    // First review blocks; every later one passes.
    reviewer: [blocked, passReview, passReview, passReview],
  });

  const alerts = [];
  const result = await superviseRun(root, {
    worktree, baseRef: base, runtime, config: config(), durationMs: 120_000,
    notifyRepair: silentRepairNotify,
    notify: async state => {
      const open = state.escalations.filter(item => !item.resolvedAt);
      alerts.push(open.map(item => item.taskId));
      return { attempted: true, delivered: true, reason: null,
        results: open.map(item => ({ id: item.id, delivered: true, reason: null, briefPath: null })) };
    },
  });

  const byId = Object.fromEntries(result.state.tasks.map(task => [task.id, task]));
  assert.equal(byId['ambiguous-one'].status, 'blocked', 'the hard task is parked');
  assert.equal(byId['independent-two'].status, 'accepted',
    'the INDEPENDENT task still ran — the night did not end at the first hard problem');

  const open = result.state.escalations.filter(item => !item.resolvedAt);
  assert.equal(open.length, 1);
  assert.equal(open[0].taskId, 'ambiguous-one', 'the escalation names the task, not the run');
  assert.equal(open[0].notified, true, 'Nick was told, even though the loop carried on');
  assert.ok(alerts.length >= 1);
  // Only once everything else is done does the run actually stop.
  assert.equal(result.state.status, 'escalated');
});

test('the reviewer re-runs the checks instead of trusting the worker', async t => {
  // An independent review that takes the author's word for the test results is
  // not independent. The worker here claims green on a file that does not parse.
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan(), { maxAttempts: 1 });

  const runtime = new FakeRuntime({
    // Writes broken JavaScript, runs the check (which fails), then insists.
    worker: [
      '### FILE: sandbox/widget.mjs\n```javascript\nexport const version = ;;;\n```\n### CHECK',
      '### DONE\nAll checks pass.',
      '### DONE\nThey really do.',
    ],
    reviewer: [passReview],
  });

  const result = await superviseRun(root, {
    worktree, baseRef, runtime, config: config(), durationMs: 40_000,
    notify: silentNotify, notifyRepair: silentRepairNotify,
  });

  // The worker never gets a checkpoint, so the reviewer is never even reached —
  // `### DONE` is refused while a check is failing. Broken work cannot reach
  // the gate, which is the stronger property.
  assert.notEqual(result.state.tasks[0].status, 'accepted');
  assert.equal(result.state.tasks[0].commit, null);
  assert.equal(await currentHead(worktree), baseRef, 'nothing was committed');
});
