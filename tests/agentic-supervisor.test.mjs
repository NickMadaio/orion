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
import { initializeProjectAgent, readProjectAgent } from '../scripts/lib/orion-project-agent.mjs';
import { superviseRun, recoverRun } from '../scripts/lib/agentic/supervisor.mjs';
import { acquireLease } from '../scripts/lib/agentic/lease.mjs';
import { readJournal } from '../scripts/lib/agentic/journal.mjs';
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
      text: typeof next === 'function' ? next(prompt) : next,
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
const silentNotify = async () => ({ attempted: false, delivered: false, reason: 'test', briefPath: null, message: null });

test('a task is implemented, checked, committed, reviewed and closed without a human', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  const runtime = new FakeRuntime({
    worker: writeThenDone('export const version = 2;'),
    reviewer: [passReview, passReview],
  });

  const result = await superviseRun(root, {
    worktree, baseRef, runtime, config: config(), durationMs: 60_000, notify: silentNotify,
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
    worktree, baseRef, runtime, config: config(), durationMs: 30_000, notify: silentNotify,
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
    worktree, baseRef: base, runtime, config: config(), durationMs: 60_000, notify: silentNotify,
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
    notify: async state => { alerts.push(state.escalation); return { attempted: true, delivered: true, reason: null, briefPath: '/tmp/brief.md', message: 'x' }; },
  });

  assert.equal(result.state.status, 'escalated');
  assert.equal(result.state.escalation.kind, 'architecture');
  assert.equal(result.state.escalation.recommendAstra, true, 'an architecture block is an Astra question');
  assert.equal(result.state.escalation.notified, true);
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
    worktree, baseRef, runtime, config: config(), durationMs: 60_000, notify: silentNotify,
  });

  assert.equal(result.state.status, 'escalated');
  assert.equal(result.state.tasks[0].status, 'awaiting_review', 'the gate failed closed');
  assert.notEqual(result.state.tasks[0].status, 'accepted');
  assert.match(result.state.escalation.reason, /could not produce a valid review/);
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
    worktree, baseRef, runtime, config: config(), durationMs: 90_000, notify: silentNotify,
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
    worktree, baseRef, runtime: new FakeRuntime({}), config: config(), durationMs: 5_000, notify: silentNotify,
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
    worktree, baseRef, runtime, config: config(), durationMs: 120_000, notify: silentNotify,
  });
  assert.equal(result.state.status, 'escalated');
  assert.ok(result.iterations < 20, `the loop should stop quickly, ran ${result.iterations} iterations`);
});

test('a heartbeat distinguishes a busy supervisor from a crashed one', async t => {
  const { root, worktree, baseRef } = await repository(t);
  await initializeProjectAgent(root, plan());
  await superviseRun(root, {
    worktree, baseRef, runtime: new FakeRuntime({ worker: writeThenDone('export const version = 2;'), reviewer: [passReview, passReview] }),
    config: config(), durationMs: 60_000, notify: silentNotify,
  });
  const beat = JSON.parse(await readFile(join(root, 'heartbeat.json'), 'utf8'));
  assert.equal(beat.phase, 'stopped', 'the final heartbeat says the supervisor is gone');
  assert.ok(beat.pid > 0 && beat.bootId, 'the heartbeat carries provable ownership');
});
