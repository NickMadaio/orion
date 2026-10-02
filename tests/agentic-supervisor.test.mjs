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
import { initializeProjectAgent, mutateProjectAgent, readProjectAgent, runProjectAgent, steerProjectAgent } from '../scripts/lib/orion-project-agent.mjs';
import { superviseRun as productionSuperviseRun, recoverRun } from '../scripts/lib/agentic/supervisor.mjs';
import { acquireLease, inspectLease } from '../scripts/lib/agentic/lease.mjs';
import { readJournal } from '../scripts/lib/agentic/journal.mjs';
import { ActivityChannel, readActivity } from '../scripts/lib/agentic/activity.mjs';
import { DEFAULT_CONFIG } from '../scripts/lib/agentic/models.mjs';
import { changedFiles, currentHead, diffSince } from '../scripts/lib/agentic/workspace.mjs';

// Discord alerts are LIVE on this machine, and every notifier defaults to the
// real one. So every notifier is silenced here unless a test passes its own: a
// test that forgot one would otherwise tell Nick's phone that a test passed.
const superviseRun = (root, options) => productionSuperviseRun(root, {
  notify: async () => ({ attempted: false, delivered: false, reason: 'test', results: [] }),
  notifyRepair: async () => ({ attempted: false, delivered: false, reason: 'test' }),
  notifyStuck: async () => ({ attempted: false, delivered: false, reason: 'test' }),
  notifyRecovery: async () => ({ delivered: false }),
  ...options,
});

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
  async generate(role, { prompt, signal }) {
    this.calls.push({ role, prompt });
    const startedAt = Date.now();
    const queue = this.script[role] ?? [];
    const next = queue.length > 1 ? queue.shift() : (queue[0] ?? '');
    // Honour the abort signal exactly as `ModelRuntime` does. Without this a
    // fake generation is uninterruptible, and a test of EXTERMINATE would pass
    // by waiting for the task timeout — proving the opposite of the point.
    const text = typeof next === 'function'
      ? await Promise.race([
        next(prompt),
        new Promise((_, reject) => signal?.addEventListener('abort',
          () => reject(new Error('aborted generation')), { once: true })),
      ])
      : next;
    return {
      role, model: `fake-${role}`, ms: Math.max(1, Date.now() - startedAt), handoff: { evicted: [], resident: role },
      text,
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

test('repair diffs include untracked first-checkpoint files without staging them', async t => {
  const { worktree, baseRef } = await repository(t);
  await writeFile(join(worktree, 'sandbox/new-module.mjs'), 'export const ready = true;\n');

  const diff = await diffSince(worktree, baseRef, { paths: ['sandbox/'] });

  assert.match(diff.stat, /new-module\.mjs/);
  assert.match(diff.patch, /new file mode/);
  assert.match(diff.patch, /export const ready = true/);
  assert.equal((await changedFiles(worktree)).find(file => file.path === 'sandbox/new-module.mjs')?.status, '??',
    'collecting review evidence must not stage the file');
});

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

test('a terminal escalation retries a transient alert failure before exiting', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({
    worker: writeThenDone('export const version = 2;'),
    reviewer: ['```json\n{"verdict":"BLOCKED","summary":"needs a decision","escalationReason":"human judgement required","escalationKind":"architecture"}\n```'],
  });
  let attempts = 0;
  const cfg = config();
  const notify = async state => {
    attempts += 1;
    const open = state.escalations.filter(item => !item.resolvedAt && !item.notified);
    const delivered = attempts > 1;
    return { attempted: true, delivered, reason: delivered ? null : 'temporary transport failure',
      results: open.map(item => ({ id: item.id, delivered, reason: delivered ? null : 'temporary transport failure' })) };
  };
  const result = await superviseRun(root, { worktree, baseRef, runtime,
    config: { ...cfg, limits: { ...cfg.limits, escalationAlertRetryMs: 5 } },
    durationMs: 60_000, notify });
  assert.equal(attempts, 2);
  assert.equal(result.state.status, 'escalated');
  assert.equal(result.state.escalations[0].notified, true);
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

  // The gate never opens, however long the reviewer stays broken.
  assert.notEqual(result.state.tasks[0].status, 'accepted', 'the gate failed closed');
  // But Nick is not the first resort: the checkpoint went back to the worker to
  // resubmit before anything reached him. A reviewer that never recovers still
  // reaches him in the end, which is the point of having a last rung.
  assert.ok((await readJournal(root)).some(event => event.kind === 'review_returned_to_worker'),
    'the loop handed the checkpoint back before escalating');
  assert.equal(result.state.status, 'escalated', 'a reviewer that never recovers still reaches Nick');
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
  assert.match(open[0].reason, /runtime recovery could not resume|worker_or_validation_failed|blocked|no remaining move/);
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

test('directory-scope baseline agrees with independent review for a legacy orphan', async t => {
  const { root, worktree, baseRef } = await repository(t);
  const tasks = plan();
  tasks[0].scope = ['sandbox/'];
  tasks[0].checks.push('no-orphan-exports');
  await initializeProjectAgent(root, tasks);
  const runtime = new FakeRuntime({ worker: writeThenDone('export const version = 2;'), reviewer: [passReview, passReview] });
  const result = await superviseRun(root, { worktree, baseRef, runtime, config: config(), durationMs: 60000, notify: silentNotify, notifyRepair: silentRepairNotify });
  assert.equal(result.state.status, 'completed');
  assert.equal(result.state.escalations.length, 0);
});

test('a self-review checkpoint permits self-correction and withholds only self-approval', async t => {
  const { root, worktree, baseRef } = await repository(t);
  const tasks = plan(); tasks[0].risk = 'high';
  await initializeProjectAgent(root, tasks);
  const runtime = new FakeRuntime({ worker: [
    '### FILE: sandbox/widget.mjs\n```javascript\nexport const version = 2;\n```\n### CHECK\n### DONE\nfinished',
    // The checkpoint turn: the correction IS applied (mission §3 — the worker
    // self-corrects), while the ### DONE riding along with it is withheld,
    // because the worker does not get to approve its own work.
    '### FILE: sandbox/widget.mjs\n```javascript\nexport const version = 3;\n```\n### DONE\nfinished',
    '### CHECK\n### DONE\nCorrected after reviewing against the contract.',
  ], reviewer: [passReview, passReview] });
  const result = await superviseRun(root, { worktree, baseRef, runtime, config: config(), durationMs: 60000, notify: silentNotify, notifyRepair: silentRepairNotify });
  assert.equal(result.state.status, 'completed');
  assert.match(runtime.calls[1].prompt, /SELF-REVIEW CHECKPOINT/);
  assert.match(await readFile(join(worktree, 'sandbox/widget.mjs'), 'utf8'), /version = 3/,
    'the self-correction made during the checkpoint was applied');
  const journal = await readJournal(root);
  assert.ok(journal.some(event => event.kind === 'worker_self_review'));
  assert.ok(journal.some(event => event.kind === 'worker_checkpoint_withheld'),
    'the withheld DONE was recorded rather than silently dropped');
});

test('a PASS_WITH_TASKS final review returns work to the worker instead of waking Nick', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  // The final review asks for a cross-cutting correction INSIDE the run scope.
  // Mission §4 (corrected 2026-09-22): that is a local verdict, so it becomes a
  // task the worker does — not an escalation.
  const finalWithTasks = '```json\n{"verdict":"PASS_WITH_TASKS","taskId":"final-review","summary":"one thing left",' +
    '"examined":["sandbox/widget.mjs"],"passed":[],"failed":[],"corrections":[{"title":"document the version",' +
    '"objective":"add a comment above the export explaining what version means",' +
    '"acceptance":["the file still parses"],"scope":["sandbox/widget.mjs"],"weight":1}]}\n```';
  const runtime = new FakeRuntime({
    worker: [...writeThenDone('export const version = 2;'), ...writeThenDone('// the schema version\nexport const version = 2;')],
    reviewer: [passReview, finalWithTasks, passReview, passReview],
  });

  const result = await superviseRun(root, {
    worktree, baseRef, runtime, config: config(), durationMs: 60_000, notify: silentNotify, notifyRepair: silentRepairNotify,
  });

  assert.equal(result.state.escalations.length, 0, 'nobody was woken for a correction the loop could do');
  const correction = result.state.tasks.find(task => task.origin === 'review_correction');
  assert.ok(correction, 'the final review produced a correction task');
  assert.deepEqual(correction.dependencies, [], 'every planned task was already accepted, so it waits on nothing');
  assert.ok(correction.scope.every(entry => ['sandbox/widget.mjs', 'sandbox/'].includes(entry)),
    'the correction inherited the run scope and did not widen it');
});

test('a worker that is busy but getting nowhere is handed to the reviewer, and Nick is told', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  // Informational lines are for when Nick is out; asleep (the default) they are held.
  await steerProjectAgent(root, 'alerts', undefined, 'away');
  // Every reply is DIFFERENT — so repetition detection never fires — but none
  // of them writes a new file or fixes a check. That is the expensive shape:
  // busy all night against the same wall.
  const churn = Array.from({ length: 10 }, (_, i) =>
    `### FILE: sandbox/widget.mjs\n\`\`\`javascript\nexport const version = ${i} +; // attempt ${i}, still broken\n\`\`\`\n### CHECK`);
  const stuckAlerts = [];
  const runtime = new FakeRuntime({
    worker: churn,
    // The reviewer's repair breaks the deadlock, and the file it writes passes.
    reviewer: ['```json\n{"diagnosis":"the worker kept rewriting the same constant","rationale":"write the value the contract asks for"}\n```\n### FILE: sandbox/widget.mjs\n```javascript\nexport const version = 2;\n```', passReview, passReview],
  });

  const result = await superviseRun(root, {
    worktree, baseRef, runtime, config: config(), durationMs: 60_000,
    notify: silentNotify, notifyRepair: silentRepairNotify,
    notifyStuck: async (_root, payload) => { stuckAlerts.push(payload); return { attempted: true, delivered: true, reason: null }; },
  });

  const journal = await readJournal(root);
  assert.ok(journal.some(event => event.kind === 'worker_stuck'), 'the runtime noticed it was stuck');
  assert.equal(stuckAlerts.length, 1, 'Nick was told exactly once, informationally');
  assert.equal(stuckAlerts[0].taskId, 'bump-version');
  assert.ok(result.repairs >= 1, 'the reviewer was brought in to break it out');
  // And it did not wait for the attempt budget to run out first: the hand-off
  // happened on the FIRST attempt, which is the whole point of the stuck gate.
  // (If the worker then gets stuck again after the repair, the ordinary bounds
  // take over and the run escalates — which is what should happen.)
  assert.equal(stuckAlerts[0].attempts, 1,
    'the reviewer intervened on the first attempt rather than after the budget ran out');
  assert.equal(result.state.repairs.length, 1, 'the intervention is recorded as reviewer-authored');
});

test('STOP ends the run at a safe boundary and leaves it resumable', async t => {
  const { root, worktree, baseRef } = await repository(t);
  const state = await initializeProjectAgent(root, plan());
  await steerProjectAgent(root, 'stop', state.revision);
  const runtime = new FakeRuntime({ worker: writeThenDone('export const version = 2;'), reviewer: [passReview] });

  const result = await superviseRun(root, {
    worktree, baseRef, runtime, config: config(), durationMs: 60_000, notify: silentNotify, notifyRepair: silentRepairNotify,
  });

  assert.equal(result.stoppedByOperator, 'stop');
  assert.equal(result.state.tasks[0].status, 'queued', 'nothing was claimed, so there is nothing to reconcile');
  assert.equal((await changedFiles(worktree)).length, 0, 'the tree is clean');
  assert.equal(await currentHead(worktree), baseRef);
  assert.ok((await readJournal(root)).some(event => event.kind === 'run_stopped_by_operator'));
});

test('EXTERMINATE abandons the generation in flight without damaging the tree', async t => {
  const { root, worktree, baseRef } = await repository(t);
  const state = await initializeProjectAgent(root, plan());
  // A worker that writes a partial file and then hangs, exactly as a 27B
  // mid-generation would look to an operator who cannot wait for it.
  let started;
  const hanging = new Promise(resolve => { started = resolve; });
  const runtime = new FakeRuntime({ worker: [async () => { started(); await new Promise(() => {}); }], reviewer: [passReview] });

  const run = superviseRun(root, {
    worktree, baseRef, runtime, config: config(), durationMs: 60_000, heartbeatMs: 25,
    notify: silentNotify, notifyRepair: silentRepairNotify,
  });
  await hanging;
  const current = await readProjectAgent(root);
  const requestedAt = Date.now();
  await steerProjectAgent(root, 'exterminate', current.revision);
  const result = await run;
  // The whole point: it does NOT wait for the task timeout (20s here).
  assert.ok(Date.now() - requestedAt < 5_000,
    'the in-flight generation was abandoned promptly rather than timing out');

  assert.equal((await changedFiles(worktree)).length, 0, 'no half-written mutation is left behind');
  assert.equal(await currentHead(worktree), baseRef, 'nothing accepted was lost or invented');
  // The worker DEMONSTRABLY stopped — its promise settled once the abort reached
  // it — so the outcome is known, not uncertain. An earlier version asserted
  // 'worker_outcome_unknown' here, and that state could never be restarted:
  // resume refused an interrupted run and run refused a standing stop.
  assert.equal(result.state.tasks[0].status, 'queued', 'the operator stopped it; the worker did not fail');
  assert.equal(result.state.tasks[0].attempts, 0, 'an operator-stopped attempt is refunded, not spent');
  assert.notEqual(result.state.status, 'interrupted', 'a settled worker leaves nothing to reconcile');
  assert.equal((await inspectLease(join(root, 'worker.lock'))).held, false, 'a settled worker releases its lease');
  assert.ok((await readJournal(root)).some(event => event.kind === 'exterminate_requested'));
});

for (const phase of ['review', 'repair', 'final']) {
  test(`EXTERMINATE cancels ${phase} and ignores an uncooperative model's late reply`, async t => {
    const { root, worktree, baseRef } = await repository(t);
    await initializeProjectAgent(root, plan(), { maxAttempts: phase === 'repair' ? 1 : 3 });
    let entered, finish, receivedSignal, reviewerCalls = 0, workerCalls = 0;
    const started = new Promise(resolve => { entered = resolve; });
    const response = text => ({ text, model: 'fake', ms: 1, handoff: { evicted: [] }, meta: { doneReason: 'stop', thinkingChars: 0 } });
    const runtime = {
      probe: async () => ({}), releaseAll: async () => {},
      async generate(role, { signal }) {
        if (role === 'worker') {
          workerCalls++;
          if (phase === 'repair') throw new Error('transient worker failure');
          return response(workerCalls === 1 ? writeThenDone('export const version = 2;')[0] : '### DONE\nversion is 2');
        }
        reviewerCalls++;
        if (phase === 'final' && reviewerCalls === 1) return response(passReview);
        receivedSignal = signal;
        entered();
        return new Promise(resolve => { finish = () => resolve(response(phase === 'repair'
          ? '### FILE: sandbox/widget.mjs\n```javascript\nexport const version = 999;\n```\n```json\n{"diagnosis":"fix","rationale":"fix"}\n```'
          : passReview)); });
      },
    };
    const cfg = config();
    if (phase === 'repair') { cfg.limits.maxAttempts = 1; cfg.limits.repairAfterAttempts = 1; }
    const running = superviseRun(root, { worktree, baseRef, runtime, config: cfg, durationMs: 10000, heartbeatMs: 10,
      notify: silentNotify, notifyRepair: silentRepairNotify, notifyStuck: silentRepairNotify });
    await started;
    const before = await readProjectAgent(root);
    const head = await currentHead(worktree);
    await steerProjectAgent(root, 'exterminate', before.revision);
    const result = await running;
    assert.equal(receivedSignal.aborted, true);
    assert.equal(result.state.finalReview, false);
    assert.equal(result.state.reviews.length, before.reviews.length);
    assert.equal(result.state.repairs.length, 0);
    assert.equal(result.state.escalations.length, 0, 'operator cancellation is not an escalation');
    finish();
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(await currentHead(worktree), head, 'late model reply cannot create a commit');
    assert.equal((await changedFiles(worktree)).length, 0, 'late repair cannot write files');
    assert.equal((await readProjectAgent(root)).revision, result.state.revision);
  });
}

test('a transient worker failure retries from HEAD and then completes within budget', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  let calls = 0;
  const runtime = new FakeRuntime({ worker: [
    writeThenDone('export const version = ;')[0],
    () => { throw new Error('temporary inference failure'); },
    prompt => { assert.match(prompt, /version = 1/); calls++; return writeThenDone('export const version = 2;')[0]; },
    '### DONE\nCompleted after retry.',
  ], reviewer: [passReview, passReview] });
  const result = await superviseRun(root, { worktree, baseRef, runtime, config: config(), durationMs: 20000,
    notify: silentNotify, notifyRepair: silentRepairNotify, notifyStuck: silentRepairNotify });
  assert.equal(result.state.status, 'completed');
  assert.equal(result.state.tasks[0].attempts, 2);
  assert.equal(calls, 1); assert.equal(result.state.escalations.length, 0);
});

test('an inference runtime timeout is recovered without spending a task attempt or stopping the loop', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const timeout = Object.assign(new Error('inference timeout'), {
    name: 'RecoverableRuntimeError', code: 'ORION_INFERENCE_RUNTIME', recoverableRuntime: true,
  });
  const runtime = new FakeRuntime({
    worker: [() => { throw timeout; }, ...writeThenDone('export const version = 2;')],
    reviewer: [
      '```json\n{"action":"retry","reason":"Transient inference timeout; retry from the durable boundary."}\n```',
      passReview,
      passReview,
    ],
  });
  const result = await superviseRun(root, {
    worktree, baseRef, runtime, config: config(), durationMs: 20_000,
    notify: silentNotify, notifyRepair: silentRepairNotify, notifyStuck: silentRepairNotify,
  });
  assert.equal(result.state.status, 'completed');
  assert.equal(result.state.tasks[0].attempts, 1, 'the infrastructure failure did not consume a coding attempt');
  assert.equal(result.state.runtimeRecoveries.length, 1);
  assert.equal(result.state.runtimeRecoveries[0].action, 'retry');
  assert.equal(result.state.escalations.length, 0);
  assert.ok((await readJournal(root)).some(event => event.kind === 'worker_runtime_failure'));
});

test('ordinary failures use all three attempts before bounded repair', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({ worker: [() => { throw new Error('temporary inference failure'); }],
    reviewer: ['```json\n{"escalate":{"kind":"judgement","reason":"repair cannot resolve"}}\n```'] });
  const result = await superviseRun(root, { worktree, baseRef, runtime, config: config(), durationMs: 20000,
    notify: silentNotify, notifyRepair: silentRepairNotify, notifyStuck: silentRepairNotify });
  assert.equal(runtime.calls.filter(call => call.role === 'worker').length, 3);
  assert.equal(runtime.calls.filter(call => call.role === 'reviewer').length, 1);
  assert.equal(result.state.tasks[0].attempts, 3);
  assert.equal(result.state.status, 'escalated');
});

test('a worker request for human judgement never enters automatic retry or repair', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan(), { maxAttempts: 1 });
  const cfg = config(); cfg.limits.maxAttempts = 1; cfg.limits.repairAfterAttempts = 1;
  const runtime = new FakeRuntime({ worker: ['### BLOCKED\nNeed the operator to choose a design.'], reviewer: [passReview] });
  const result = await superviseRun(root, { worktree, baseRef, runtime, config: cfg, durationMs: 10000,
    notify: silentNotify, notifyRepair: silentRepairNotify, notifyStuck: silentRepairNotify });
  assert.equal(runtime.calls.length, 1);
  assert.equal(result.state.tasks[0].blocker, 'worker_declined');
  assert.equal(result.state.status, 'escalated');
});

test('STOP can be cleared and a newly launched supervisor finishes the existing run', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({ worker: [writeThenDone('export const version = 2;')[0], async () => {
    const current = await readProjectAgent(root); await steerProjectAgent(root, 'stop', current.revision); return '### DONE\nversion is 2';
  }], reviewer: [passReview, passReview] });
  const options = { worktree, baseRef, runtime, config: config(), durationMs: 10000,
    notify: silentNotify, notifyRepair: silentRepairNotify, notifyStuck: silentRepairNotify };
  const stopped = await superviseRun(root, options);
  assert.equal(stopped.state.stopRequested, true);
  assert.equal(stopped.state.tasks[0].status, 'awaiting_review');
  await steerProjectAgent(root, 'resume', stopped.state.revision);
  const completed = await superviseRun(root, options);
  assert.equal(completed.state.status, 'completed');
  assert.equal(completed.state.tasks[0].attempts, 1, 'restart reviews the existing checkpoint instead of rerunning it');
});

test('Exterminate during repair commit preserves its audit but prevents notification and requeue', async t => {
  const { commitRepair } = await import('../scripts/lib/agentic/reviewer.mjs');
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan(), { maxAttempts: 1 });
  const cfg = config(); cfg.limits.maxAttempts = 1; cfg.limits.repairAfterAttempts = 1;
  let notifications = 0;
  const runtime = new FakeRuntime({ worker: [() => { throw new Error('temporary failure'); }],
    reviewer: ['### FILE: sandbox/widget.mjs\n```javascript\nexport const version = 2;\n```\n```json\n{"diagnosis":"corrected version","rationale":"meets contract"}\n```'] });
  const result = await superviseRun(root, { worktree, baseRef, runtime, config: cfg, durationMs: 10000, heartbeatMs: 10,
    notify: silentNotify, notifyStuck: silentRepairNotify,
    notifyRepair: async () => { notifications++; return { delivered: true }; },
    checkpointRepair: async (...args) => {
      const committed = await commitRepair(...args);
      const state = await readProjectAgent(root);
      await steerProjectAgent(root, 'exterminate', state.revision);
      return committed;
    },
  });
  assert.equal(notifications, 0);
  assert.equal(result.state.tasks[0].status, 'blocked');
  assert.equal(result.state.tasks[0].repairsUsed, 0);
  assert.equal(result.state.escalations.length, 0);
  assert.equal(result.state.repairs.length, 1, 'an already-created commit remains auditable');
  assert.equal(result.state.repairs[0].commit, await currentHead(worktree));
});

test('re-reading a file already in view is answered, and three in a row is stuck, not a spent attempt', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  let second = '';
  const runtime = new FakeRuntime({ worker: [
    '### READ: sandbox/widget.mjs',
    prompt => { second = prompt; return '### READ: sandbox/widget.mjs'; },
    '### READ: sandbox/widget.mjs',
  ], reviewer: ['not json'] });
  const result = await superviseRun(root, { worktree, baseRef, runtime, config: config(), durationMs: 5_000 });
  assert.match(second, /Already in your working set, shown in full under FILES above: sandbox\/widget\.mjs/);
  const blocked = (await readJournal(root)).find(event => event.kind === 'blocked');
  assert.match(blocked.message, /worker_stuck/, 'repetition goes to the reviewer rung');
  assert.equal(result.state.tasks[0].attempts <= 1, true);
});

test('a resumed task keeps its own unfinished files; another task never inherits them', async t => {
  const { appendJournal } = await import('../scripts/lib/agentic/journal.mjs');
  for (const [writer, kept] of [['bump-version', true], ['someone-else', false]]) {
    const { root, worktree, baseRef } = await repository(t);
    const state = await initializeProjectAgent(root, plan());
    await writeFile(join(worktree, 'sandbox/widget.mjs'), 'export const version = 2; // half done\n');
    await appendJournal(root, { seq: null, runId: state.runId, actor: 'agent', kind: 'worker_write', taskId: writer, turn: 3 });
    const events = [];
    await recoverRun(root, { worktree, baseRef, emit: event => events.push(event.kind) });
    const onDisk = await readFile(join(worktree, 'sandbox/widget.mjs'), 'utf8');
    assert.equal(onDisk.includes('half done'), kept, `written by ${writer}`);
    assert.equal(events.includes('partial_work_kept'), kept);
  }
});

test('finished work is submitted for review, not called stuck, when self-review exchanges keep DONE away', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  // The live 2026-09-25 shape: checks green, then exchanges that re-check under
  // changing subtask labels and never say DONE.
  const runtime = new FakeRuntime({ worker: [
    '### FILE: sandbox/widget.mjs\n```javascript\nexport const version = 2;\n```\n### CHECK',
    '### SUBTASK: 1/3 review the write\n### CHECK',
    '### SUBTASK: 2/3 review the tests\n### CHECK',
    '### SUBTASK: 3/3 final pass\n### CHECK',
    '### CHECK',
  ], reviewer: [passReview, passReview] });
  const result = await superviseRun(root, { worktree, baseRef, runtime, config: config(), durationMs: 60_000 });
  assert.equal(result.state.tasks[0].status, 'accepted');
  const journal = await readJournal(root);
  assert.ok(journal.some(event => event.kind === 'worker_green_submitted'));
  assert.ok(!journal.some(event => event.kind === 'worker_stuck'));
});

test('kept work can be checked and submitted on the first exchange of the next attempt', async t => {
  const { appendJournal } = await import('../scripts/lib/agentic/journal.mjs');
  const { root, worktree, baseRef } = await repository(t);
  const state = await initializeProjectAgent(root, plan());
  await writeFile(join(worktree, 'sandbox/widget.mjs'), 'export const version = 2;\n');
  await appendJournal(root, { seq: null, runId: state.runId, actor: 'agent', kind: 'worker_write', taskId: 'bump-version', turn: 2 });
  const runtime = new FakeRuntime({ worker: ['### CHECK', '### DONE\nKept work passes.'], reviewer: [passReview, passReview] });
  const result = await superviseRun(root, { worktree, baseRef, runtime, config: config(), durationMs: 60_000 });
  assert.equal(result.state.tasks[0].status, 'accepted');
  const firstCheck = (await readJournal(root)).find(event => event.kind === 'checks_run');
  assert.equal(firstCheck?.turn ?? firstCheck?.data?.turn, 1, 'the kept files were checked on the first exchange');
});

test('a worker investigating is not mistaken for a worker that is stuck', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  // Six turns of pure investigation — more than stuckAfterTurns — then real
  // work. The system prompt tells the worker to do exactly this when an attempt
  // has failed the same way twice, so it must not be read as being stuck.
  const runtime = new FakeRuntime({ worker: [
    '### READ: sandbox/widget.mjs',
    '### SEARCH: version',
    '### READ: sandbox/widget.mjs',
    '### SEARCH: export',
    '### SEARCH: widget',
    '### READ: sandbox/widget.mjs',
    ...writeThenDone('export const version = 2;'),
  ], reviewer: [passReview, passReview] });

  const result = await superviseRun(root, {
    worktree, baseRef, runtime, config: config(), durationMs: 60_000, notify: silentNotify, notifyRepair: silentRepairNotify,
    notifyStuck: async () => ({ attempted: false, delivered: false, reason: 'test' }),
  });

  assert.equal(result.state.tasks[0].status, 'accepted', 'investigation was allowed to finish the task');
  assert.ok(!(await readJournal(root)).some(event => event.kind === 'worker_stuck'),
    'reading and searching is not being counted as stuck');
});

test('a correction made during self-review resets the stuck counter', async t => {
  const { root, worktree, baseRef } = await repository(t);
  const risky = plan();
  risky[0].risk = 'high';
  await initializeProjectAgent(root, risky);
  const runtime = new FakeRuntime({
    worker: [
      '### FILE: sandbox/widget.mjs\n```javascript\nexport const version = 3 +;\n```\n### CHECK',
      'The self-review found the value misses the acceptance criterion.\n' +
        '### FILE: sandbox/widget.mjs\n```javascript\nexport const version = 2;\n```\n### CHECK',
      '### DONE\nCorrected the value found during self-review.',
    ],
    reviewer: [passReview, passReview],
  });
  const cfg = config();
  cfg.limits.iterationStallLimit = 2;

  const result = await superviseRun(root, {
    worktree, baseRef, runtime, config: cfg, durationMs: 60_000,
    notify: silentNotify, notifyRepair: silentRepairNotify,
  });

  assert.equal(result.state.tasks[0].status, 'accepted');
  assert.ok(!(await readJournal(root)).some(event => event.kind === 'worker_stuck'),
    'a changed file at the requested review checkpoint is progress, not churn');
});

test('a worker can check and submit a clean reviewer repair without rewriting it', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({
    worker: [
      '### FILE: sandbox/widget.mjs\n```javascript\nexport const version = 3 +;\n```\n### CHECK',
      '### FILE: sandbox/widget.mjs\n```javascript\nexport const version = 4 +;\n```\n### CHECK',
      '### CHECK',
      '### DONE\nThe reviewer repair passes the registered check.',
    ],
    reviewer: [
      '```json\n{"diagnosis":"correct the value","rationale":"the contract requires version 2"}\n```\n' +
        '### FILE: sandbox/widget.mjs\n```javascript\nexport const version = 2;\n```',
      passReview,
      passReview,
    ],
  });
  const cfg = config();
  cfg.limits.stuckAfterTurns = 2;

  const result = await superviseRun(root, {
    worktree, baseRef, runtime, config: cfg, durationMs: 60_000,
    notify: silentNotify, notifyRepair: silentRepairNotify,
  });

  assert.equal(result.state.status, 'completed');
  assert.equal(result.state.tasks[0].commit, result.state.repairs[0].commit,
    'the checked repair commit is reviewed directly instead of rewritten');
  assert.equal(runtime.calls.filter(call => call.role === 'worker').length, 2,
    'the host checks the repair without another worker-model generation');
  assert.ok((await readJournal(root)).some(event =>
    event.kind === 'checkpoint' && event.reviewerRepairReused === true));
});

test('reviewer reloads models after a review transport failure and resumes through final review', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({ worker: writeThenDone('export const version = 2;'), reviewer: [
    () => { throw new Error('temporary connection reset'); },
    '```json\n{"action":"reload_models","reason":"Reset a stale model session and retry review"}\n```',
    passReview, passReview,
  ] });
  const result = await superviseRun(root, { worktree, baseRef, runtime, config: config(), durationMs: 60_000,
    notify: silentNotify, notifyRepair: silentRepairNotify, notifyStuck: silentRepairNotify });
  assert.equal(result.state.status, 'completed');
  assert.equal(result.state.runtimeRecoveries.length, 1);
  assert.equal(result.state.runtimeRecoveries[0].action, 'reload_models');
  assert.equal(result.state.tasks[0].attempts, 1);
  assert.equal(result.state.escalations.length, 0);
});

test('runtime recovery budget persists across calls and refuses commands and operator stops', async t => {
  const { recoverRuntime } = await import('../scripts/lib/agentic/recovery.mjs');
  const { root } = await repository(t);
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({ reviewer: ['{"action":"retry","reason":"transient"}'] });
  const args = { root, runtime, error: new Error('transport'), phase: 'review', limits: config().limits };
  assert.equal(await recoverRuntime(args), true);
  assert.equal(await recoverRuntime(args), true);
  assert.equal(await recoverRuntime({ ...args, error: new Error('changed text') }), false);
  assert.equal(runtime.calls.length, 2);
  runtime.script.reviewer = ['{"action":"shell","reason":"run arbitrary command"}'];
  assert.equal(await recoverRuntime({ ...args, phase: 'other' }), false);
  const state = await readProjectAgent(root);
  assert.equal(state.runtimeRecoveries.at(-1).outcome, 'failed');
  await steerProjectAgent(root, 'stop', state.revision);
  assert.equal(await recoverRuntime({ ...args, phase: 'another' }), false);
  assert.equal(runtime.calls.length, 3);
});

test('reviewer recovery escalation prevents another review attempt and delivers an alert', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({ worker: writeThenDone('export const version = 2;'), reviewer: [
    () => { throw new Error('transport failure'); },
    '{"action":"escalate","reason":"needs a human"}', passReview,
  ] });
  let alerts = 0;
  const result = await superviseRun(root, { worktree, baseRef, runtime, config: config(),
    notify: async () => { alerts++; return { results: [] }; }, notifyRepair: silentRepairNotify, notifyStuck: silentRepairNotify });
  assert.equal(result.state.status, 'escalated');
  assert.equal(runtime.calls.filter(c => c.role === 'reviewer').length, 2);
  assert.equal(alerts, 1);
});

test('runtime recovery cancellation during unload prevents continuation', async t => {
  const { recoverRuntime } = await import('../scripts/lib/agentic/recovery.mjs');
  const { root } = await repository(t);
  await initializeProjectAgent(root, plan());
  const controller = new AbortController();
  const runtime = new FakeRuntime({ reviewer: ['{"action":"reload_models","reason":"stale session"}'] });
  runtime.releaseAll = async ({ signal }) => { controller.abort(); signal.throwIfAborted(); };
  const result = await recoverRuntime({ root, runtime, error: new Error('transport'), phase: 'review',
    signal: controller.signal, limits: config().limits });
  assert.equal(result, false);
  assert.equal((await readProjectAgent(root)).runtimeRecoveries[0].outcome, 'failed');
});

test('when the reviewer cannot be reached, the host waits and retries within the same budget', async t => {
  const { recoverRuntime } = await import('../scripts/lib/agentic/recovery.mjs');
  const { root } = await repository(t);
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({ reviewer: [() => { throw new Error('connect ECONNREFUSED 127.0.0.1:11434'); }] });
  const events = [];
  const args = { root, runtime, error: new Error('fetch failed'), phase: 'review', limits: config().limits,
    backoffMs: 5, emit: event => events.push(event.kind) };
  assert.equal(await recoverRuntime(args), true, 'a model server restarting is not a reason to end the night');
  const [record] = (await readProjectAgent(root)).runtimeRecoveries;
  assert.equal(record.decidedBy, 'host');
  assert.equal(record.action, 'retry');
  assert.equal(record.outcome, 'retry_authorized');
  assert.ok(events.includes('runtime_recovery_reviewer_unreachable'));
  // Same budget as a reviewer decision: the second phase-retry is the last.
  assert.equal(await recoverRuntime(args), true);
  assert.equal(await recoverRuntime(args), false, 'the host fallback cannot outlast the budget');
});

test('an exterminate during the host backoff ends recovery at once', async t => {
  const { recoverRuntime } = await import('../scripts/lib/agentic/recovery.mjs');
  const { root } = await repository(t);
  await initializeProjectAgent(root, plan());
  const controller = new AbortController();
  const runtime = new FakeRuntime({ reviewer: [() => { throw new Error('socket hang up'); }] });
  setTimeout(() => controller.abort(new Error('exterminated by the operator')), 20);
  const started = Date.now();
  const result = await recoverRuntime({ root, runtime, error: new Error('fetch failed'), phase: 'review',
    signal: controller.signal, limits: config().limits, backoffMs: 60_000 });
  assert.equal(result, false);
  assert.ok(Date.now() - started < 5_000, 'the backoff is abandoned, not waited out');
  assert.equal((await readProjectAgent(root)).runtimeRecoveries[0].outcome, 'failed');
});

test('memory pressure refunds the attempt and the host unloads, waits and retries without asking the reviewer', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const [write, done] = writeThenDone('export const version = 2;');
  const pressure = () => { const e = new Error('resource guard: swap is still climbing'); e.recoverableRuntime = true; e.resourcePressure = true; throw e; };
  const runtime = new FakeRuntime({ worker: [pressure, write, done], reviewer: [passReview, passReview] });
  const cfg = config();
  const result = await superviseRun(root, { worktree, baseRef, runtime, durationMs: 60_000,
    config: { ...cfg, limits: { ...cfg.limits, resourceSettleMs: 5 } } });
  assert.equal(result.state.tasks[0].status, 'accepted');
  assert.equal(result.state.tasks[0].attempts, 1, 'the pressure stop did not cost an attempt');
  assert.equal(runtime.released, true, 'the model was unloaded before the retry');
  assert.equal(result.state.runtimeRecoveries[0].decidedBy, 'host');
  assert.equal(runtime.calls.filter(c => c.role === 'reviewer').length, 2, 'only the two real reviews; no reviewer call to diagnose memory');
});

test('a parked task does not switch recovery off for the rest of the run; a run-level escalation does', async t => {
  const { recoverRuntime } = await import('../scripts/lib/agentic/recovery.mjs');
  const { escalateProjectAgent } = await import('../scripts/lib/orion-project-agent.mjs');
  const { root } = await repository(t);
  // Two independent tasks, so parking one really does leave the night work to do.
  let state = await initializeProjectAgent(root, [...plan(), { ...plan()[0], id: 'other-work', title: 'Other work' }]);
  state = await escalateProjectAgent(root, state.revision, { taskId: state.tasks[0].id, kind: 'judgement', reason: 'parked for Nick' });
  assert.notEqual(state.status, 'escalated', 'fixture: the run itself is not held');
  const runtime = new FakeRuntime({ reviewer: ['{"action":"retry","reason":"transient"}'] });
  const args = { root, runtime, error: new Error('transport'), phase: 'review', limits: config().limits };
  assert.equal(await recoverRuntime(args), true, 'one parked task must not stop the night on the next hiccup');
  state = await readProjectAgent(root);
  await escalateProjectAgent(root, state.revision, { taskId: null, kind: 'judgement', reason: 'the whole run needs Nick' });
  assert.equal(await recoverRuntime({ ...args, phase: 'other' }), false, 'a run-level escalation still holds everything');
});

test('a task reconciled after a hard-killed exterminate does not switch recovery off for the rest of the night', async t => {
  const { recoverRuntime } = await import('../scripts/lib/agentic/recovery.mjs');
  const { root } = await repository(t);
  await initializeProjectAgent(root, [...plan(), { ...plan()[0], id: 'other-work', title: 'Other work' }]);
  // The shape recoverRun leaves behind once the dead worker is proven dead:
  // the task parked with an uncertain outcome, the run itself free to go on.
  await mutateProjectAgent(root, undefined, state => {
    state.tasks[0].status = 'blocked';
    state.tasks[0].blocker = 'worker_outcome_unknown';
    state.tasks[0].attempts = 1; // the attempt the interrupted worker spent
  });
  const runtime = new FakeRuntime({ reviewer: ['{"action":"retry","reason":"transient"}'] });
  assert.equal(await recoverRuntime({ root, runtime, error: new Error('transport'), phase: 'review', limits: config().limits }), true);
});

test('a worker that reads many reference files keeps its own file in view', async t => {
  const { root, worktree, baseRef } = await repository(t);
  // Nine committed reference files: more than the working set holds.
  const refs = Array.from({ length: 9 }, (_, index) => `ref/module-${index}.mjs`);
  await mkdir(join(worktree, 'ref'), { recursive: true });
  for (const ref of refs) await writeFile(join(worktree, ref), `export const reference = ${JSON.stringify(ref)};\n`);
  git(worktree, 'add', '.'); git(worktree, '-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-qm', 'references');
  await initializeProjectAgent(root, plan());
  let seen = '';
  const [write, done] = writeThenDone('export const version = 2;');
  const runtime = new FakeRuntime({ worker: [
    `Reading everything first.\n${refs.map(ref => `### READ ${ref}`).join('\n')}`,
    prompt => { seen = prompt; return write; },
    done,
  ], reviewer: [passReview, passReview] });
  const result = await superviseRun(root, { worktree, baseRef: git(worktree, 'rev-parse', 'HEAD').trim(), runtime,
    config: config(), durationMs: 60_000 });
  assert.match(seen, /### sandbox\/widget\.mjs\n```\nexport const version = 1;/, 'the file being changed is still visible');
  // Seven reads fit beside the task's own file; the other two are skipped and
  // named, rather than evicting reads made in the same exchange.
  assert.equal((seen.match(/^### ref\/module-\d\.mjs$/gm) ?? []).length, 7, '8 in view, own file kept');
  assert.match(seen, /### ref\/module-0\.mjs\n/, 'nothing read this exchange was thrown away');
  assert.match(seen, /Not read this exchange.*ref\/module-7\.mjs, ref\/module-8\.mjs/);
  assert.equal(result.state.tasks[0].status, 'accepted');
  assert.ok(baseRef);
});

test('after a reply starved by thinking, thinking stays off until a usable action', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  class StarvingRuntime extends FakeRuntime {
    async generate(role, options) {
      if (role === 'worker') (this.thinking ??= []).push(options.think);
      const queue = this.script[role] ?? [];
      if (role === 'worker' && queue[0] === STARVE) {
        queue.shift();
        return { role, model: 'fake-worker', ms: 1, handoff: { evicted: [], resident: role }, text: '',
          meta: { thinkingChars: 48000, doneReason: 'length', evalCount: 16000, promptEvalCount: 1 } };
      }
      return super.generate(role, options);
    }
  }
  const STARVE = Symbol('starve');
  const [write, done] = writeThenDone('export const version = 2;');
  const runtime = new StarvingRuntime({ worker: [STARVE, STARVE, write, done], reviewer: [passReview, passReview] });
  const result = await superviseRun(root, { worktree, baseRef, runtime, config: config(), durationMs: 60_000 });
  assert.equal(result.state.tasks[0].status, 'accepted');
  assert.deepEqual(runtime.thinking.slice(0, 4), [undefined, false, false, undefined],
    'thinking remains off through repeated starvation, then returns after usable output');
  assert.ok((await readJournal(root)).some(event => event.kind === 'worker_thinking_disabled'));
});

test('a review that fails while the model server is down still finishes the run', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const down = () => { throw new Error('connect ECONNREFUSED 127.0.0.1:11434'); };
  const runtime = new FakeRuntime({ worker: writeThenDone('export const version = 2;'),
    reviewer: [down, down, passReview, passReview] });
  const cfg = config();
  const result = await superviseRun(root, { worktree, baseRef, runtime, durationMs: 60_000,
    config: { ...cfg, limits: { ...cfg.limits, runtimeRecoveryBackoffMs: 5 } } });
  assert.equal(result.state.status, 'completed');
  assert.equal(result.state.runtimeRecoveries.length, 1);
  assert.equal(result.state.runtimeRecoveries[0].decidedBy, 'host');
  assert.equal(result.state.escalations.length, 0);
});

// ---------------------------------------------------------------------------
// The failure ladder: nothing ends the night that a rung below Nick can handle.
// ---------------------------------------------------------------------------

const repairFix = contents => '```json\n{"diagnosis":"the worker could not settle the constant","rationale":"write the value the contract asks for"}\n```\n' +
  `### FILE: sandbox/widget.mjs\n\`\`\`javascript\n${contents}\n\`\`\``;

test('after EXTERMINATE the run can be resumed and a fresh supervisor finishes it', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  let started;
  const hanging = new Promise(resolve => { started = resolve; });
  const first = superviseRun(root, {
    worktree, baseRef, runtime: new FakeRuntime({ worker: [async () => { started(); await new Promise(() => {}); }], reviewer: [passReview] }),
    config: config(), durationMs: 60_000, heartbeatMs: 25, notify: silentNotify, notifyRepair: silentRepairNotify,
  });
  await hanging;
  await steerProjectAgent(root, 'exterminate', (await readProjectAgent(root)).revision);
  await first;

  // The deadlock this replaces: resume refused an interrupted run, and run
  // refused a standing stop, so neither the panel nor the CLI could continue.
  const stopped = await readProjectAgent(root);
  await steerProjectAgent(root, 'resume', stopped.revision);
  const result = await superviseRun(root, {
    worktree, baseRef, runtime: new FakeRuntime({ worker: writeThenDone('export const version = 2;'), reviewer: [passReview, passReview] }),
    config: config(), durationMs: 60_000, notify: silentNotify, notifyRepair: silentRepairNotify,
  });
  assert.equal(result.state.status, 'completed', 'the exterminated run was picked back up and finished');
  assert.equal(result.state.escalations.length, 0);
});

test('resume clears a standing stop even when a worker never settled, leaving reconciliation to recovery', async t => {
  const { root } = await repository(t);
  await initializeProjectAgent(root, plan());
  // A worker that ignores its abort signal entirely — the genuinely uncertain
  // case. Only this may still leave the run interrupted.
  const state = await runProjectAgent(root, { worker: () => new Promise(() => {}), verify: async () => true,
    durationMs: 60_000, taskTimeoutMs: 80, settleGraceMs: 40 });
  assert.equal(state.status, 'interrupted');
  await steerProjectAgent(root, 'exterminate', state.revision);
  const flagged = await readProjectAgent(root);
  const resumed = await steerProjectAgent(root, 'resume', flagged.revision);
  assert.equal(resumed.stopRequested, false, 'the stop no longer stands');
  assert.equal(resumed.exterminateRequested, false);
  assert.equal(resumed.status, 'interrupted', 'reconciliation still belongs to recovery, which needs proof the writer is dead');
});

test('a worker timeout is handed to the reviewer and the night continues', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  await steerProjectAgent(root, 'alerts', undefined, 'away');
  const told = [];
  const runtime = new FakeRuntime({
    worker: [async () => new Promise(() => {}), ...writeThenDone('export const version = 2; // after repair')],
    reviewer: [repairFix('export const version = 2;'), passReview, passReview],
  });
  const result = await superviseRun(root, {
    worktree, baseRef, runtime, durationMs: 60_000, notify: silentNotify, notifyRepair: silentRepairNotify,
    config: { ...config(), limits: { ...config().limits, taskTimeoutMs: 1_500 } },
    notifyStuck: async (_root, payload) => { told.push(payload); return { attempted: true, delivered: true, reason: null }; },
  });
  assert.equal(result.state.status, 'completed', 'a slow attempt no longer ends the run');
  assert.equal(result.state.escalations.length, 0, 'nobody was woken for something the loop handled');
  assert.equal(result.state.repairs.length, 1, 'the reviewer took the timed-out task');
  assert.equal(told.length, 1, 'Nick was told once, informationally');
  assert.equal(told[0].blocker, 'worker_timeout');
});

test('a stray unreviewed commit is never built on', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  // What a worker leaves behind when it commits and then fails verification:
  // a commit on the run branch that no review ever saw.
  await writeFile(join(worktree, 'sandbox/stray.mjs'), 'export const stray = true;\n');
  git(worktree, 'add', '.');
  git(worktree, '-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-qm', 'unreviewed');
  const stray = git(worktree, 'rev-parse', 'HEAD').trim();
  const s0 = await readProjectAgent(root);
  await mutateProjectAgent(root, s0.revision, state => {
    Object.assign(state.tasks[0], { status: 'blocked', stage: 'queued', attempts: 1, blocker: 'worker_or_validation_failed' });
    state.status = 'waiting_for_review';
  });

  const result = await superviseRun(root, {
    worktree, baseRef, runtime: new FakeRuntime({ worker: writeThenDone('export const version = 2;'), reviewer: [passReview, passReview] }),
    config: config(), durationMs: 60_000, notify: silentNotify, notifyRepair: silentRepairNotify,
  });
  assert.equal(result.state.status, 'completed');
  assert.throws(() => git(worktree, 'merge-base', '--is-ancestor', stray, 'HEAD'),
    'the unreviewed commit is not in the history the reviewer approved');
  await assert.rejects(readFile(join(worktree, 'sandbox/stray.mjs'), 'utf8'), 'and its file is gone');
});

test('a reviewer that fails twice hands the checkpoint back to the worker, with the reason', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({
    worker: [...writeThenDone('export const version = 2;'), ...writeThenDone('export const version = 2; // smaller')],
    // Two review passes of unusable output (each pass tries twice), then healthy.
    reviewer: ['no verdict here', 'still none', 'nothing', 'nope', passReview, passReview],
  });
  const result = await superviseRun(root, {
    worktree, baseRef, runtime, config: config(), durationMs: 60_000, notify: silentNotify, notifyRepair: silentRepairNotify,
  });
  assert.equal(result.state.status, 'completed', 'the loop handled a stuck reviewer itself');
  assert.equal(result.state.escalations.length, 0, 'nobody was woken');
  const retryPrompt = runtime.calls.filter(call => call.role === 'worker').at(-2).prompt;
  assert.match(retryPrompt, /WHY THIS TASK CAME BACK/, 'the worker was told why it got the task back');
  assert.match(retryPrompt, /reviewer could not/i);
});

test('a reviewer repair that fails still gives the worker its retry', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const churn = Array.from({ length: 5 }, (_, i) =>
    `### FILE: sandbox/widget.mjs\n\`\`\`javascript\nexport const version = ${i} +; // attempt ${i}, still broken\n\`\`\`\n### CHECK`);
  const runtime = new FakeRuntime({
    worker: [...churn, ...writeThenDone('export const version = 2;')],
    reviewer: [async () => { throw new Error('reviewer transport dropped'); }, passReview, passReview],
  });
  const result = await superviseRun(root, {
    worktree, baseRef, runtime, config: config(), durationMs: 60_000, notify: silentNotify, notifyRepair: silentRepairNotify,
    notifyStuck: async () => ({ attempted: false, delivered: false, reason: 'test' }),
  });
  assert.equal(result.state.status, 'completed', 'a failed repair did not end the task');
  assert.equal(result.state.escalations.length, 0);
  assert.equal(result.state.tasks[0].repairsUsed, 1, 'the failed repair still counts against the bound');
});

/*
 DEFERRAL AND ALERT MODES (2026-09-25).

 Nick, the morning after: "it escalates to me wayyyy too much ... it makes no
 sense having it constantly texting me something went wrong when im not awake."
 A task the local ladder gives up on is deferred for Astra; independent work
 carries on; asleep, nothing is sent until one silent digest when the run stops.
*/
async function twoIndependentTasks(t) {
  const { root, worktree } = await repository(t);
  await writeFile(join(worktree, 'sandbox/second.mjs'), 'export const second = 1;\n');
  git(worktree, 'add', '.');
  git(worktree, '-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-qm', 'second');
  await initializeProjectAgent(root, [
    { id: 'hard-one', title: 'The hard one', objective: 'version is 2', weight: 1, dependencies: [],
      scope: ['sandbox/widget.mjs'], checks: ['node-syntax'], acceptance: ['widget version 2'] },
    { id: 'independent-two', title: 'Unrelated work', objective: 'second is 2', weight: 1, dependencies: [],
      scope: ['sandbox/second.mjs'], checks: ['node-syntax'], acceptance: ['second is 2'] },
  ]);
  const runtime = new FakeRuntime({
    worker: [
      'Reasoning.\n### FILE: sandbox/widget.mjs\n```javascript\nexport const version = 2;\n```\n### CHECK',
      '### DONE\nBumped the widget.',
      'Reasoning.\n### FILE: sandbox/second.mjs\n```javascript\nexport const second = 2;\n```\n### CHECK',
      '### DONE\nBumped second.',
    ],
    reviewer: ['```json\n{"verdict":"BLOCKED","summary":"ambiguous","escalationReason":"two defensible designs","escalationKind":"architecture"}\n```',
      passReview, passReview, passReview],
  });
  return { root, worktree, baseRef: git(worktree, 'rev-parse', 'HEAD').trim(), runtime };
}

const recordingNotify = calls => async (state, options) => {
  const open = state.escalations.filter(item => !item.resolvedAt && !item.notified);
  calls.push({ digest: options.digest === true, silent: options.silent === true, taskIds: open.map(item => item.taskId) });
  return { attempted: true, delivered: true, reason: null, results: open.map(item => ({ id: item.id, delivered: true, reason: null })) };
};

test('asleep, a deferral sends nothing until one silent digest when the run stops', async t => {
  const { root, worktree, baseRef, runtime } = await twoIndependentTasks(t);
  const calls = [];
  const result = await superviseRun(root, { worktree, baseRef, runtime, config: config(), durationMs: 120_000,
    notify: recordingNotify(calls) });
  const byId = Object.fromEntries(result.state.tasks.map(task => [task.id, task]));
  assert.equal(byId['independent-two'].status, 'accepted', 'independent work carried on past the deferral');
  assert.equal(result.state.escalations[0].deferred, true, 'a task-level escalation is a deferral');
  assert.deepEqual(calls, [{ digest: true, silent: true, taskIds: ['hard-one'] }],
    'exactly one message, a silent digest, and only once the run could go no further');
  const journal = await readJournal(root);
  assert.ok(journal.some(event => event.kind === 'deferral_held'), 'holding it back is recorded, not silent');
  assert.equal(result.state.escalations[0].notified, true);
});

test('away, each deferral is sent as it happens and the stop digest is not silent', async t => {
  const { root, worktree, baseRef, runtime } = await twoIndependentTasks(t);
  await steerProjectAgent(root, 'alerts', undefined, 'away');
  const calls = [];
  const result = await superviseRun(root, { worktree, baseRef, runtime, config: config(), durationMs: 120_000,
    notify: recordingNotify(calls) });
  assert.equal(result.state.tasks.find(task => task.id === 'independent-two').status, 'accepted');
  assert.deepEqual(calls[0], { digest: false, silent: false, taskIds: ['hard-one'] },
    'told while the other task was still to run');
  assert.equal(calls.length, 1, 'already told, so the stop has nothing new to send');
});

test('a stopped run sends a silent digest for a run-level stop too', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({ worker: writeThenDone('export const version = 2;'),
    reviewer: ['```json\n{"verdict":"BLOCKED","summary":"no","escalationReason":"needs a decision","escalationKind":"architecture"}\n```'] });
  const calls = [];
  await superviseRun(root, { worktree, baseRef, runtime, config: config(), durationMs: 60_000, notify: recordingNotify(calls) });
  assert.deepEqual(calls, [{ digest: true, silent: true, taskIds: ['bump-version'] }]);
});

test('a reviewer repair that leaves checks failing gives the worker more tries, not an escalation', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({
    worker: [async () => new Promise(() => {}), ...writeThenDone('export const version = 2;')],
    // The repair is syntactically broken: checks still fail after it.
    reviewer: [repairFix('export const version = 2 +;'), passReview, passReview],
  });
  const result = await superviseRun(root, { worktree, baseRef, runtime, durationMs: 60_000,
    config: { ...config(), limits: { ...config().limits, taskTimeoutMs: 1_500 } } });
  assert.equal(result.state.escalations.length, 0, 'the worker finished what the repair started');
  assert.equal(result.state.status, 'completed');
  assert.match(runtime.calls.find(call => call.role === 'worker' && /checks still fail after the repair/.test(call.prompt))?.prompt ?? '',
    /checks still fail after the repair/, 'the worker was told the repair did not finish the job');
});

test('the alert mode is validated and needs no revision', async t => {
  const { root } = await repository(t);
  await initializeProjectAgent(root, plan());
  assert.equal((await readProjectAgent(root)).alertMode, 'quiet', 'asleep is the default');
  assert.equal((await steerProjectAgent(root, 'alerts', undefined, 'away')).alertMode, 'away');
  await assert.rejects(steerProjectAgent(root, 'alerts', undefined, 'loud'), /alert mode/);
});

test('the digest names what was accepted, what was deferred, and what waits on it', async () => {
  const { runDigest } = await import('../scripts/lib/agentic/escalation.mjs');
  const task = (id, status, dependencies = []) => ({ id, status, dependencies });
  const message = runDigest({
    tasks: [task('a', 'accepted'), task('b', 'blocked', ['a']), task('c', 'queued', ['b']), task('d', 'accepted')],
    escalations: [{ id: 'x', taskId: 'b', reason: 'checks still fail after repair', resolvedAt: null },
      { id: 'y', taskId: 'a', reason: 'old', resolvedAt: '2026-09-25T00:00:00Z' }],
  }, { project: 'demo', packetPath: '/p/astra-deferred.md' });
  assert.match(message, /demo run stopped · 2\/4 tasks accepted/);
  assert.match(message, /Deferred for Astra \(1\):\n• b — checks still fail after repair/);
  assert.match(message, /Waiting on a deferred task: c/);
  assert.match(message, /Astra packet: \/p\/astra-deferred\.md/);
  assert.doesNotMatch(message, /old/, 'a resolved escalation is not reported again');
});

/*
 EDIT (2026-09-25). The live task 3 was not stuck: it ran out of its hour while
 retyping 20-35 KB files at about seven minutes a write, twice without checking
 in between, and the reviewer's repair was cut off retyping the same file.
*/
test('EDIT hunks apply exactly once, forgive trailing spaces, and fail whole with a reason', async () => {
  const { applyEdits } = await import('../scripts/lib/agentic/edits.mjs');
  const { parseWorkerReply } = await import('../scripts/lib/agentic/prompts.mjs');
  const [edit] = parseWorkerReply('### EDIT: sandbox/widget.mjs\n```\n<<<<<<< SEARCH\nconst a = 1;   \n=======\nconst a = 2;\n>>>>>>> REPLACE\n<<<<<<< SEARCH\nconst b = 1;\n=======\n>>>>>>> REPLACE\n```');
  assert.equal(edit.kind, 'EDIT');
  assert.equal(edit.hunks.length, 2);
  assert.equal(applyEdits('const a = 1;\nconst b = 1;\nkeep\n', edit.hunks), 'const a = 2;\n\nkeep\n',
    'trailing whitespace is forgiven, and an empty REPLACE deletes');
  assert.throws(() => applyEdits('x\nx\n', [{ search: 'x', replace: 'y' }]), /matches 2 places/);
  assert.throws(() => applyEdits('const a = 1;\n', [{ search: 'const a = 1;', replace: 'z' }, { search: 'missing', replace: '' }]),
    /block 2 of 2 does not match/);
  assert.equal(parseWorkerReply('### EDIT: a.mjs\nno hunks here')[0].kind, 'MALFORMED');
});

test('the worker changes a file with EDIT and sees the checks without asking', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({
    worker: [
      // Broken on purpose, and no ### CHECK: the check must still run.
      '### EDIT: sandbox/widget.mjs\n```\n<<<<<<< SEARCH\nexport const version = 1;\n=======\nexport const version = 2 +;\n>>>>>>> REPLACE\n```',
      '### EDIT: sandbox/widget.mjs\n```\n<<<<<<< SEARCH\nexport const version = 2 +;\n=======\nexport const version = 2;\n>>>>>>> REPLACE\n```',
      '### DONE\nBumped the version with two edits.',
    ],
    reviewer: [passReview, passReview],
  });
  const result = await superviseRun(root, { worktree, baseRef, runtime, config: config(), durationMs: 60_000 });
  assert.equal(result.state.status, 'completed');
  assert.equal(await readFile(join(worktree, 'sandbox/widget.mjs'), 'utf8'), 'export const version = 2;\n');
  const checks = (await readJournal(root)).filter(event => event.kind === 'checks_run');
  assert.equal(checks[0]?.turn ?? checks[0]?.data?.turn, 1, 'the first edit was checked in its own exchange');
  assert.equal(checks[0].results?.[0]?.ok ?? checks[0].data?.results?.[0]?.ok, false);
  assert.match(runtime.calls.filter(call => call.role === 'worker')[1].prompt, /node-syntax — FAIL/i,
    'the worker saw the failure it caused before its next change');
});

test('an EDIT that does not match changes nothing and says which block failed', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({
    worker: [
      '### EDIT: sandbox/widget.mjs\n```\n<<<<<<< SEARCH\nexport const version = 7;\n=======\nexport const version = 2;\n>>>>>>> REPLACE\n```',
      '### EDIT: sandbox/widget.mjs\n```\n<<<<<<< SEARCH\nexport const version = 1;\n=======\nexport const version = 2;\n>>>>>>> REPLACE\n```',
      '### DONE\nBumped.',
    ],
    reviewer: [passReview, passReview],
  });
  const result = await superviseRun(root, { worktree, baseRef, runtime, config: config(), durationMs: 60_000 });
  assert.equal(result.state.status, 'completed');
  assert.match(runtime.calls.filter(call => call.role === 'worker')[1].prompt,
    /EDIT sandbox\/widget\.mjs NOT APPLIED, the file is unchanged: SEARCH block 1 of 1 does not match/);
});

test('a reviewer repair can EDIT instead of retyping the file', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({
    worker: [async () => new Promise(() => {}), '### DONE\nThe repair already made the change; checks pass.'],
    reviewer: ['```json\n{"diagnosis":"one constant","rationale":"smallest change","remaining":"submit"}\n```\n' +
      '### EDIT: sandbox/widget.mjs\n```\n<<<<<<< SEARCH\nexport const version = 1;\n=======\nexport const version = 2;\n>>>>>>> REPLACE\n```',
      passReview, passReview],
  });
  const result = await superviseRun(root, { worktree, baseRef, runtime, durationMs: 60_000,
    config: { ...config(), limits: { ...config().limits, taskTimeoutMs: 1_500 } } });
  assert.equal(result.state.repairs.length, 1);
  assert.equal(result.state.status, 'completed');
  assert.equal(await readFile(join(worktree, 'sandbox/widget.mjs'), 'utf8'), 'export const version = 2;\n');
});

/*
 THE SOFT HOUR (2026-09-25). Nick: "the hour limit isnt as strictly enforced if
 its making progress. the reviewer can extend or add time based on progress and
 eta for task completion."
*/
const slow = (ms, text) => () => new Promise(resolve => setTimeout(() => resolve(text), ms));

test('extension: no recent progress means no time, and the reviewer is not even asked', async () => {
  const { decideExtension } = await import('../scripts/lib/agentic/extension.mjs');
  let asked = 0;
  const runtime = { generate: async () => { asked += 1; return { text: '{"extendMinutes":30}' }; } };
  const base = { runtime, task: { id: 't', title: 'T' }, exchanges: [], checkResults: [], elapsedMs: 3_600_000,
    grantedMs: 0, hardRemainingMs: 3 * 3_600_000, maxGrantMs: 45 * 60_000, defaultGrantMs: 20 * 60_000 };
  assert.equal((await decideExtension({ ...base, turn: 9, progressTurns: [1, 2, 3] })).grantMs, 0, 'progress was too long ago');
  assert.equal(asked, 0);
  const granted = await decideExtension({ ...base, turn: 9, progressTurns: [7] });
  assert.equal(granted.grantMs, 30 * 60_000);
  assert.equal(granted.by, 'reviewer');
  const capped = await decideExtension({ ...base, turn: 9, progressTurns: [8], hardRemainingMs: 10 * 60_000 });
  assert.equal(capped.grantMs, 10 * 60_000, 'no grant passes the hard ceiling');
  const unusable = await decideExtension({ ...base, runtime: { generate: async () => ({ text: 'sure, more time' }) },
    turn: 9, progressTurns: [8] });
  assert.deepEqual([unusable.grantMs, unusable.by], [20 * 60_000, 'host'], 'progress is recent, so the host default stands');
  const ceiling = await decideExtension({ ...base, turn: 9, progressTurns: [8], hardRemainingMs: 0 });
  assert.equal(ceiling.grantMs, 0);
});

test('a worker that is progressing when its time runs short is given more by the reviewer, and finishes', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({
    worker: [
      slow(700, '### EDIT: sandbox/widget.mjs\n```\n<<<<<<< SEARCH\nexport const version = 1;\n=======\nexport const version = 2 +;\n>>>>>>> REPLACE\n```'),
      slow(700, '### EDIT: sandbox/widget.mjs\n```\n<<<<<<< SEARCH\nexport const version = 2 +;\n=======\nexport const version = 2;\n>>>>>>> REPLACE\n```'),
      slow(700, '### DONE\nBumped the version.'),
    ],
    reviewer: ['```json\n{"extendMinutes":1,"etaMinutes":1,"reason":"the syntax error is being fixed"}\n```', passReview, passReview],
  });
  const result = await superviseRun(root, { worktree, baseRef, runtime, durationMs: 15 * 60_000,
    config: { ...config(), limits: { ...config().limits, taskTimeoutMs: 1_600, taskHardTimeoutMs: 10 * 60_000 } } });
  const journal = await readJournal(root);
  assert.equal(result.state.status, 'completed', 'the first budget ran out mid-task and the task still finished');
  const extended = journal.find(event => event.kind === 'deadline_extended');
  assert.ok(extended, 'the extension is on the record');
  assert.equal(extended.by ?? extended.data?.by, 'reviewer');
  assert.equal(extended.etaMinutes ?? extended.data?.etaMinutes, 1);
  assert.ok(!journal.some(event => event.kind === 'blocked'), 'it never timed out');
});

test('with no room under the hard ceiling, the first budget is still a wall', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan(), { maxAttempts: 1 });
  const runtime = new FakeRuntime({
    worker: [
      slow(700, '### EDIT: sandbox/widget.mjs\n```\n<<<<<<< SEARCH\nexport const version = 1;\n=======\nexport const version = 2 +;\n>>>>>>> REPLACE\n```'),
      slow(700, '### EDIT: sandbox/widget.mjs\n```\n<<<<<<< SEARCH\nexport const version = 2 +;\n=======\nexport const version = 2;\n>>>>>>> REPLACE\n```'),
      slow(700, '### DONE\nBumped the version.'),
    ],
    reviewer: ['```json\n{"diagnosis":"n/a","rationale":"n/a"}\n```'],
  });
  await superviseRun(root, { worktree, baseRef, runtime, durationMs: 20_000,
    config: { ...config(), limits: { ...config().limits, taskTimeoutMs: 1_600, taskHardTimeoutMs: 1_600, repairsPerTask: 0 } } });
  const journal = await readJournal(root);
  assert.ok(!journal.some(event => event.kind === 'deadline_extended'));
  assert.ok(journal.some(event => (event.data?.message ?? event.message ?? '').includes('worker_timeout')),
    'it timed out as before');
});

/*
 EXISTING WORK (2026-09-25). Nick, before handing the loop Astra's whole plan:
 "at the start of every task double check whats already there for this ... not
 overwrite unless its improvements."
*/
test('the overwrite guard refuses lost exports, lost tests and wholesale replacement, but not asked-for changes', async () => {
  const { overwriteRisk } = await import('../scripts/lib/agentic/existing.mjs');
  const module = 'export function keep() {}\nexport function other() {}\n' + '// line\n'.repeat(50);
  assert.match(overwriteRisk('m.mjs', module, 'export function keep() {}\n'), /remove existing export\(s\) other/);
  assert.equal(overwriteRisk('m.mjs', module, 'export function keep() {}\n', { contractText: 'Remove other() entirely.' }) === null ||
    /replace m\.mjs/.test(overwriteRisk('m.mjs', module, 'export function keep() {}\n', { contractText: 'Remove other().' })), true,
    'a removal the contract names is not a lost export');
  assert.match(overwriteRisk('t.test.mjs', "test('a', () => {});\ntest('b', () => {});\n", "test('a', () => {});\n"), /from 2 to 1 test case/);
  const shrunk = 'export function keep() {}\nexport function other() {}\n';
  assert.match(overwriteRisk('m.mjs', module, shrunk), /discarding most of the existing file/);
  assert.equal(overwriteRisk('m.mjs', module, shrunk, { wholeFile: false }), null, 'an EDIT that deletes lines on purpose is surgical');
  assert.equal(overwriteRisk('m.mjs', module, `${module}export function added() {}\n`), null, 'improving is always allowed');
  assert.equal(overwriteRisk('new.mjs', undefined, 'anything'), null, 'a new file has nothing to lose');
});

test('the survey says what exists and where a promised function is already defined', async t => {
  const { worktree } = await repository(t);
  const { surveyExistingWork, renderSurvey } = await import('../scripts/lib/agentic/existing.mjs');
  await writeFile(join(worktree, 'sandbox/helpers.mjs'), 'export function bumpVersion(v) { return v + 1; }\n');
  git(worktree, 'add', '.');
  git(worktree, '-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-qm', 'helpers');
  const survey = await surveyExistingWork(worktree, { ...plan()[0], scope: ['sandbox/widget.mjs', 'sandbox/new.mjs'],
    acceptance: ['Export bumpVersion(v) returning v + 1.', 'Export freshThing() that is new.'] });
  const text = renderSurvey(survey);
  assert.match(text, /sandbox\/widget\.mjs — EXISTS: \d+ lines, exports version; last changed/);
  assert.match(text, /sandbox\/new\.mjs — does not exist yet/);
  assert.match(text, /bumpVersion: ALREADY DEFINED in sandbox\/helpers\.mjs/);
  assert.match(text, /freshThing: not defined anywhere yet/);
});

test('a task that is already done is finished without rewriting it, and the reviewer judges the existing code', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await writeFile(join(worktree, 'sandbox/widget.mjs'), 'export const version = 2;\n');
  git(worktree, 'add', '.');
  git(worktree, '-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-qm', 'someone already did it');
  const head = git(worktree, 'rev-parse', 'HEAD').trim();
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({
    worker: ['### CHECK', '### DONE\nALREADY SATISFIED: sandbox/widget.mjs already exports version 2 (criterion 1).'],
    reviewer: [passReview, passReview],
  });
  const result = await superviseRun(root, { worktree, baseRef: head, runtime, config: config(), durationMs: 60_000 });
  assert.equal(result.state.status, 'completed');
  assert.match(runtime.calls.find(call => call.role === 'worker').prompt, /ALREADY IN THE REPOSITORY[\s\S]*sandbox\/widget\.mjs — EXISTS/);
  const review = runtime.calls.find(call => call.role === 'reviewer').prompt;
  assert.match(review, /ALREADY SATISFIED CLAIM — NO CHANGE WAS MADE/);
  assert.match(review, /export const version = 2;/, 'the reviewer saw the existing code, not just an empty diff');
  assert.equal(git(worktree, 'show', '--pretty=', '--name-only', 'HEAD').trim(), '', 'an empty checkpoint: nothing was rewritten');
  assert.match(git(worktree, 'log', '-1', '--format=%s'), /already satisfied/);
  assert.ok((await readJournal(root)).some(event => event.kind === 'already_satisfied'));
});

test('a false already-satisfied claim reaches a reviewer who sees the unchanged code, and is not accepted', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan(), { maxAttempts: 1 });
  const runtime = new FakeRuntime({
    worker: ['### CHECK', '### DONE\nALREADY SATISFIED: nothing to do.'],
    reviewer: ['```json\n{"verdict":"BLOCKED","summary":"version is still 1","escalationReason":"not done","escalationKind":"judgement"}\n```'],
  });
  const result = await superviseRun(root, { worktree, baseRef, runtime, config: config(), durationMs: 60_000 });
  assert.notEqual(result.state.tasks[0].status, 'accepted', 'a false claim is not accepted');
  assert.match(runtime.calls.find(call => call.role === 'reviewer').prompt, /export const version = 1;/,
    'the reviewer judged the real, unchanged file');
});

test('a write that would delete existing work is refused with the reason, and an edit that keeps it goes through', async t => {
  const { root, worktree } = await repository(t);
  await writeFile(join(worktree, 'sandbox/widget.mjs'), 'export const version = 1;\nexport const name = "widget";\n');
  git(worktree, 'add', '.');
  git(worktree, '-c', 'user.name=T', '-c', 'user.email=t@t', 'commit', '-qm', 'two exports');
  const head = git(worktree, 'rev-parse', 'HEAD').trim();
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({
    worker: [
      '### FILE: sandbox/widget.mjs\n```javascript\nexport const version = 2;\n```',
      '### EDIT: sandbox/widget.mjs\n```\n<<<<<<< SEARCH\nexport const version = 1;\n=======\nexport const version = 2;\n>>>>>>> REPLACE\n```',
      '### DONE\nBumped the version and kept name.',
    ],
    reviewer: [passReview, passReview],
  });
  const result = await superviseRun(root, { worktree, baseRef: head, runtime, config: config(), durationMs: 60_000 });
  assert.equal(result.state.status, 'completed');
  assert.match(runtime.calls.filter(call => call.role === 'worker')[1].prompt,
    /REFUSED sandbox\/widget\.mjs: not written, because it would remove existing export\(s\) name/);
  assert.equal(await readFile(join(worktree, 'sandbox/widget.mjs'), 'utf8'), 'export const version = 2;\nexport const name = "widget";\n');
});

test('a worker that has written nothing by half its exchanges is told to write now', async t => {
  // The roadmap run (2026-09-26): investigation tasks read and searched through
  // every exchange of three attempts and never wrote their report.
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const reading = Array.from({ length: 8 }, (_, index) => `Looking around.\n### SEARCH: needle${index}`);
  const runtime = new FakeRuntime({
    worker: [...reading, ...writeThenDone('export const version = 2;')],
    reviewer: [passReview],
  });
  await superviseRun(root, {
    worktree, baseRef, runtime, config: config(), durationMs: 120_000, notify: silentNotify, notifyRepair: silentRepairNotify,
  });
  const prompts = runtime.calls.filter(call => call.role === 'worker').map(call => String(call.prompt?.user ?? JSON.stringify(call.prompt)));
  const nudged = prompts.findIndex(text => text.includes('written nothing yet'));
  assert.ok(nudged >= 0, 'the worker was told to write');
  assert.ok(nudged >= 6, `not before half the exchanges were spent (first at exchange ${nudged + 1})`);
  assert.ok(prompts.slice(0, 6).every(text => !text.includes('written nothing yet')), 'no nudge in the first half');
});

// Regression: ORION surfaces stopped while independent tasks remained because
// a deferred Flux failure was counted once per unrelated supervisor iteration.
test('watchdog counts failed executions once and ignores deferred blockers', async () => {
  const { watchdog } = await import('../scripts/lib/agentic/supervisor.mjs');
  const guard = watchdog({ limits: { iterationStallLimit: 3, maxConsecutiveFailures: 2 } });
  const task = { id: 'flux', status: 'blocked', blocker: 'worker_stuck', attempts: 1, corrections: 0, repairsUsed: 0 };
  for (let revision = 1; revision <= 12; revision++) {
    assert.equal(guard.observe({ revision, tasks: [task], escalations: [] }, { progressed: true }).trip, false);
  }
  for (let attempts = 2; attempts <= 4; attempts++) {
    const verdict = guard.observe({ revision: 12 + attempts, tasks: [{ ...task, attempts }], escalations: [] }, { progressed: true });
    assert.equal(verdict.trip, attempts === 4, 'distinct recurring failures still trip');
  }
  const parked = watchdog({ limits: { iterationStallLimit: 3, maxConsecutiveFailures: 2 } });
  for (let attempts = 1; attempts <= 12; attempts++) {
    assert.equal(parked.observe({ revision: attempts, tasks: [{ ...task, attempts }],
      escalations: [{ taskId: 'flux', resolvedAt: null }] }, { progressed: true }).trip, false);
  }
});

test('ambiguous reviewer repair edits return diagnostics rather than declining repair', async t => {
  const { repairCheckpoint, ReviewUnusable } = await import('../scripts/lib/agentic/reviewer.mjs');
  const f = await repository(t);
  const task = { id: 'widget', scope: ['sandbox/widget.mjs'], checks: ['node-syntax'], objective: 'version is 2', acceptance: [] };
  await writeFile(join(f.worktree, 'sandbox/widget.mjs'), 'export const a = 1;\nexport const b = 1;\n');
  const runtime = new FakeRuntime({ reviewer: ['### EDIT: sandbox/widget.mjs\n<<<<<<< SEARCH\n= 1;\n=======\n= 2;\n>>>>>>> REPLACE'] });
  await assert.rejects(repairCheckpoint({ runtime, worktree: f.worktree, task, baseRef: f.baseRef, checkResults: [], history: '' }),
    error => error instanceof ReviewUnusable && /matches 2 places/.test(error.message));
});
