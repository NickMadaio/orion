import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { runCheck } from '../scripts/lib/agentic/checks.mjs';
import { searchRepo, readScoped } from '../scripts/lib/agentic/workspace.mjs';
import { assertPromptFits, fitWorkingSet } from '../scripts/lib/agentic/context.mjs';
import { parseResources, resourceConcern, guardResources } from '../scripts/lib/agentic/resources.mjs';
import { initializeProjectAgent, escalateProjectAgent, readProjectAgent } from '../scripts/lib/orion-project-agent.mjs';
import { discordBrief } from '../scripts/lib/agentic/brief.mjs';
const repo = resolve(import.meta.dirname, '..');
const git = (cwd, ...args) => execFileSync('/usr/bin/git', args, { cwd, encoding: 'utf8' });
async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'agentic-regression-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  git(root, 'init', '-q');
  return root;
}

test('uncommitted new imports count and a real unreferenced export still fails', async t => {
  const worktree = await fixture(t);
  await writeFile(join(worktree, 'greet.mjs'), 'export function greet() { return "hello"; }\n');
  let result = await runCheck('no-orphan-exports', { worktree, changedFiles: ['greet.mjs'] });
  assert.equal(result.ok, false);
  await writeFile(join(worktree, 'consumer.mjs'), 'import { greet } from "./greet.mjs"; greet();\n');
  result = await runCheck('no-orphan-exports', { worktree, changedFiles: ['greet.mjs', 'consumer.mjs'] });
  assert.equal(result.ok, true);
});

test('a failing test that prints ENOENT is a red test, not a broken machine; a passing one is never unusable', async t => {
  const worktree = await fixture(t);
  await mkdir(join(worktree, 'tests'), { recursive: true });
  const suite = join(worktree, 'tests/automation-install.test.mjs');
  // The shape tasks 2-4 of the Phase 57 batch will produce: a test about a
  // missing file that fails with node's own ENOENT message.
  await writeFile(suite, "import test from 'node:test';\nimport { readFile } from 'node:fs/promises';\n" +
    "test('reads the intent', async () => { await readFile('/nonexistent/intent.json', 'utf8'); });\n");
  let result = await runCheck('automation-install-tests', { worktree });
  assert.equal(result.ok, false);
  assert.match(result.output, /ENOENT/);
  assert.equal(result.unusable, false, 'an honest failing test must reach the worker, not park the task for Nick');

  await writeFile(suite, "import test from 'node:test';\ntest('handles ENOENT: No such file or directory', () => {});\n");
  result = await runCheck('automation-install-tests', { worktree });
  assert.equal(result.ok, true);
  assert.equal(result.unusable, false, 'a passing check is never a broken environment');
});

test('search refuses private surfaces and READ refuses aliases into or outside them', async t => {
  const root = await fixture(t);
  for (const path of ['var/brain/note.md', 'var/data/note.md', 'config/.env.local', 'config/secret.pem', 'public.mjs']) {
    await mkdir(resolve(root, path, '..'), { recursive: true });
    await writeFile(join(root, path), 'needle-content\n');
  }
  git(root, 'add', '.');
  const results = await searchRepo(root, 'needle-content');
  assert.deepEqual(results, ['public.mjs:1:needle-content']);
  await symlink(join(root, 'var/brain/note.md'), join(root, 'alias.md'));
  await assert.rejects(readScoped(root, 'alias.md'), /refusing to read/);
  await symlink('/etc/hosts', join(root, 'outside.md'));
  await assert.rejects(readScoped(root, 'outside.md'), /outside the worktree/);
});

test('context trimming preserves the contract and fails closed if it alone is oversized', () => {
  // Budget here is 4096 - 1024 output - 1024 template = 2048 INPUT tokens, and a
  // token is estimated at three UTF-8 bytes (see context.mjs) — so the fixtures
  // are sized in bytes against that, not one-byte-per-token.
  const spec = { contextTokens: 4096, maxOutputTokens: 1024 };
  const files = [{ path: 'old', contents: 'x'.repeat(9000) }, { path: 'new', contents: 'new' }];
  const dropped = [];
  const prompt = fitWorkingSet({ system: 'SYSTEM', files, spec, build: () => 'CONTRACT\n' + files.map(f => f.contents).join('\n'), onDrop: p => dropped.push(p) });
  assert.deepEqual(dropped, ['old']); assert.match(prompt, /^CONTRACT/); assert.match(prompt, /new/);
  assert.throws(() => assertPromptFits('rules'.repeat(2000), 'contract', spec), /context budget exceeded/);
  // Multibyte text is charged by BYTES, not characters: 4000 accented characters
  // are 8000 bytes, which is over budget even though 4000 characters would not be.
  assert.throws(() => assertPromptFits('', 'é'.repeat(4000), spec), /context budget exceeded/);
});

test('when a turn must shrink, reference files go before the files the task is writing', () => {
  const spec = { contextTokens: 4096, maxOutputTokens: 1024 };
  // Scope file first (oldest), exactly as the worker's initial working set is built.
  // 2,048 input tokens is ~6,100 bytes: only one 4,000-byte file fits.
  const files = [{ path: 'own.mjs', contents: 'o'.repeat(4000) }, { path: 'ref-a.mjs', contents: 'a'.repeat(4000) },
    { path: 'ref-b.mjs', contents: 'b'.repeat(4000) }];
  const dropped = [];
  fitWorkingSet({ system: 'S', files, spec, pinned: file => file.path === 'own.mjs', onDrop: path => dropped.push(path),
    build: () => files.map(file => file.contents).join('\n') });
  assert.deepEqual(dropped, ['ref-a.mjs', 'ref-b.mjs']);
  assert.deepEqual(files.map(file => file.path), ['own.mjs']);
});

test('resource guard parses macOS measurements and recognizes pressure, swap and heat', () => {
  const sample = parseResources('page size of 16384 bytes\nPages free: 100.\nPages occupied by compressor: 200.', 'vm.swapusage: used = 1024.00M\nkern.memorystatus_vm_pressure_level: 1', 'CPU_Speed_Limit = 100');
  assert.equal(sample.available, true); assert.equal(sample.swapGiB, 1);
  assert.equal(resourceConcern(sample), null);
  assert.match(resourceConcern({ ...sample, pressure: 4 }), /memory/);
  // Swap that is STILL climbing trips; a one-time step that has plateaued does
  // not. Measured 2026-09-23: loading the model is a single 1.84 GiB step, then flat.
  assert.match(resourceConcern({ ...sample, swapGiB: 3.5 }, sample, { ...sample, swapGiB: 3 }), /swap/);
  assert.equal(resourceConcern({ ...sample, swapGiB: 3.5 }, sample, { ...sample, swapGiB: 3.5 }), null,
    'a swap step that has stopped growing is macOS making room, not distress');
  assert.match(resourceConcern({ ...sample, cpuSpeedLimit: 60 }), /thermal/);
});

test('resource guard stops ongoing inference after sustained critical pressure', async () => {
  let calls = 0;
  const sample = async () => ({ available: true, pressure: ++calls === 1 ? 1 : 4, swapGiB: 0, cpuSpeedLimit: 100 });
  const guard = await guardResources({ sample, intervalMs: 5 });
  try {
    await new Promise(resolve => setTimeout(resolve, 40));
    assert.equal(guard.signal.aborted, true);
    assert.match(guard.failure.message, /critical memory/);
  } finally { guard.close(); }
});

test('operator CLI exposes and resolves the selected escalation, and brief keeps all open reasons', async t => {
  const home = await fixture(t);
  const root = join(home, '.openclaw/orion-controlled/project-agent');
  await mkdir(root, { recursive: true });
  const task = id => ({ id, title: id, objective: 'bounded work', scope: ['sandbox/'], checks: ['node-syntax'], acceptance: ['works'], weight: 1, dependencies: [] });
  let state = await initializeProjectAgent(root, [task('one'), task('two')]);
  state = await escalateProjectAgent(root, state.revision, { taskId: 'one', kind: 'judgement', reason: 'first reason' });
  state = await escalateProjectAgent(root, state.revision, { taskId: 'two', kind: 'judgement', reason: 'second reason' });
  await writeFile(join(root, 'run.json'), JSON.stringify({ project: 'test', worktree: null, baseRef: null }));
  const cli = (...args) => execFileSync(process.execPath, [join(repo, 'scripts/orion-agent'), ...args], { encoding: 'utf8', env: { ...process.env, HOME: home } });
  const status = JSON.parse(cli('status'));
  assert.equal(status.escalations.length, 2);
  const briefPath = cli('brief').trim();
  const { readFile } = await import('node:fs/promises');
  const brief = await readFile(briefPath, 'utf8');
  assert.match(brief, /first reason/); assert.match(brief, /second reason/);
  const chosen = state.escalations[1];
  assert.match(discordBrief(state, { escalation: chosen }), new RegExp(`--id ${chosen.id}`));
  cli('resolve', '--revision', String(state.revision), '--id', chosen.id, '--note', 'selected second');
  state = await readProjectAgent(root);
  assert.equal(state.escalations[0].resolvedAt, null);
  assert.ok(state.escalations[1].resolvedAt);
  assert.equal(JSON.parse(cli('status')).escalations.length, 1);
});

test('a retained worker lease has real ownership and blocks recovery until its process exits', async t => {
  const { runProjectAgent } = await import('../scripts/lib/orion-project-agent.mjs');
  const { inspectLease } = await import('../scripts/lib/agentic/lease.mjs');
  const { recoverRun } = await import('../scripts/lib/agentic/supervisor.mjs');
  const worktree = await fixture(t), root = join(worktree, 'state');
  await writeFile(join(worktree, 'file.mjs'), 'const x = 1;');
  git(worktree, 'add', '.'); git(worktree, '-c', 'user.name=T', '-c', 'user.email=t@localhost', 'commit', '-qm', 'base');
  await initializeProjectAgent(root, [{ id: 'lease-task', title: 'Lease', objective: 'bounded', scope: ['file.mjs'], checks: ['node-syntax'], acceptance: ['works'], weight: 1, dependencies: [] }]);
  const state = await runProjectAgent(root, { worker: async () => new Promise(() => {}), verify: async () => true, durationMs: 100, taskTimeoutMs: 20 });
  assert.equal(state.status, 'interrupted');
  const lease = await inspectLease(join(root, 'worker.lock'));
  assert.equal(lease.held, true); assert.equal(lease.dead, false); assert.equal(lease.owner.pid, process.pid);
  await assert.rejects(recoverRun(root, { worktree, emit: () => {} }), /Refusing to start a second writer/);
});

test('ownerless worker locks are uncertainty, while a dead child worker can be recovered', async t => {
  const { inspectLease } = await import('../scripts/lib/agentic/lease.mjs');
  const { recoverRun } = await import('../scripts/lib/agentic/supervisor.mjs');
  const dir = await fixture(t), root = join(dir, 'state'), worktree = join(dir, 'repo');
  await mkdir(worktree); git(worktree, 'init', '-q');
  await writeFile(join(worktree, 'file.mjs'), 'const x = 1;');
  git(worktree, 'add', '.'); git(worktree, '-c', 'user.name=T', '-c', 'user.email=t@localhost', 'commit', '-qm', 'base');
  await initializeProjectAgent(root, [{ id: 'lease-task', title: 'Lease', objective: 'bounded', scope: ['file.mjs'], checks: ['node-syntax'], acceptance: ['works'], weight: 1, dependencies: [] }]);
  await mkdir(join(root, 'worker.lock'));
  assert.equal((await inspectLease(join(root, 'worker.lock'))).held, true);
  await assert.rejects(recoverRun(root, { worktree, emit: () => {} }), /owner record/);
  await rm(join(root, 'worker.lock'), { recursive: true }); // this test created the empty fixture itself
  const module = new URL('../scripts/lib/orion-project-agent.mjs', import.meta.url).href;
  execFileSync(process.execPath, ['--input-type=module', '-e', `import {runProjectAgent} from ${JSON.stringify(module)}; await runProjectAgent(process.argv[1], {worker:async()=>new Promise(()=>{}),verify:async()=>true,durationMs:100,taskTimeoutMs:20});`, root]);
  const lease = await inspectLease(join(root, 'worker.lock'));
  assert.equal(lease.held, true); assert.equal(lease.dead, true);
  const recovery = await recoverRun(root, { worktree, emit: () => {} });
  assert.equal(recovery.reclaimed, true);
  assert.equal((await inspectLease(join(root, 'worker.lock'))).held, false);
});

test('resume CLI reports a stopped supervisor as requiring a local restart', async t => {
  const { steerProjectAgent } = await import('../scripts/lib/orion-project-agent.mjs');
  const home = await fixture(t), root = join(home, '.openclaw/orion-controlled/project-agent');
  let state = await initializeProjectAgent(root, [{ id: 'resume-test', title: 'Resume', objective: 'bounded', scope: ['sandbox/'], checks: ['node-syntax'], acceptance: ['works'], weight: 1, dependencies: [] }]);
  state = await steerProjectAgent(root, 'stop', state.revision);
  await writeFile(join(root, 'heartbeat.json'), JSON.stringify({ at: new Date().toISOString(), phase: 'stopped' }));
  const output = JSON.parse(execFileSync(process.execPath, [join(repo, 'scripts/orion-project-agent'), 'resume', '--revision', String(state.revision)], { encoding: 'utf8', env: { ...process.env, HOME: home } }));
  assert.equal(output.stopRequested, false);
  assert.equal(output.heartbeat.live, false);
  assert.match(output.continuation, /No supervisor is running/);
  // The legacy single root restarts through orion-agent; a project run through
  // orion-projects launch, which also takes care of keeping the Mac awake.
  // Runs are bounded by a wall-clock deadline or run until stopped (2026-09-23);
  // --hours survives only for old scripts.
  assert.match(output.continuation, /orion-agent run --(until-stopped|until \S+|hours \d+)/);
});
