/*
 The halt controls, exercised through the operator CLI exactly as the panel and
 Discord call it — against a temporary HOME, never the real one.

 What these prove is the one thing Nick said he must be able to rely on: that he
 can stop the model. Pause, stop cleanly, or kill it outright — without looking
 anything up first, and even when the process has stopped responding.
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { initializeProjectAgent, readProjectAgent } from '../scripts/lib/orion-project-agent.mjs';

const repo = resolve(import.meta.dirname, '..');
const ID = 'halt-fixture';

async function project(t) {
  // realpath: on macOS the temp directory lives under a symlinked /var, and the
  // project loader rightly refuses a project reached through a symlink.
  const home = await realpath(await mkdtemp(join(tmpdir(), 'orion-halts-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const root = join(home, '.openclaw/orion-controlled/project-agent/projects', ID);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'project.json'), JSON.stringify({ version: 1, id: ID, name: 'Halt fixture', planFile: 'plan.md',
    createdAt: new Date().toISOString(), taskCount: 1 }));
  await writeFile(join(root, 'plan.md'), '# fixture\n');
  await initializeProjectAgent(root, [{ id: 'one', title: 'One', objective: 'o', weight: 1, dependencies: [],
    scope: ['sandbox/'], checks: ['node-syntax'], acceptance: ['a'] }]);
  const cli = (...args) => JSON.parse(execFileSync(process.execPath, [join(repo, 'scripts/orion-project-agent'), '--project', ID, ...args],
    { encoding: 'utf8', env: { ...process.env, HOME: home, ORION_EXTERMINATE_GRACE_SECONDS: '1' } }));
  return { home, root, cli };
}

test('every halt works with no revision to look up', async t => {
  const { cli } = await project(t);
  assert.equal(cli('pause').pauseRequested, true);
  assert.equal(cli('resume').pauseRequested, false);
  assert.equal(cli('stop').stopRequested, true);
  assert.equal(cli('resume').stopRequested, false);
  const killed = cli('exterminate');
  assert.equal(killed.exterminateRequested, true);
  assert.match(killed.hardKill, /nothing needs killing/, 'with no supervisor running there is nothing to reap');
});

test('exterminate kills a supervisor that has stopped responding — and only that process', async t => {
  const { home, root, cli } = await project(t);
  // A supervisor that holds its lease and will never read the exterminate flag.
  const wedged = spawn(process.execPath, ['--input-type=module', '-e', `
    const { acquireLease } = await import(${JSON.stringify(join(repo, 'scripts/lib/agentic/lease.mjs'))});
    await acquireLease(${JSON.stringify(join(root, 'supervisor.lock'))}, { extra: { role: 'supervisor' } });
    process.stdout.write('holding\\n');
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, HOME: home } });
  t.after(() => { try { wedged.kill('SIGKILL'); } catch {} });
  await new Promise(resolve => wedged.stdout.once('data', resolve));
  const exited = new Promise(resolve => wedged.once('exit', (code, signal) => resolve(signal)));

  const answer = cli('exterminate');
  assert.match(answer.hardKill, new RegExp(`pid ${wedged.pid}`));
  assert.equal(await exited, 'SIGKILL', 'the unresponsive supervisor was killed');
  // The reaper records what it did, so the morning can see it.
  let receipt;
  for (let i = 0; i < 40 && !receipt; i++) {
    receipt = await readFile(join(root, 'exterminate.json'), 'utf8').then(JSON.parse, () => null);
    if (!receipt) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(receipt?.killed, true);
  assert.equal(receipt?.pid, wedged.pid);
  // And the run is restartable afterwards: resume clears the request.
  assert.equal(cli('resume').exterminateRequested, false);
  assert.equal((await readProjectAgent(root)).stopRequested, false);
});

test('a resume inside the grace window disarms the reaper: the supervisor Nick kept is not killed', async t => {
  const { home, root } = await project(t);
  const cliWith = (grace, ...args) => JSON.parse(execFileSync(process.execPath,
    [join(repo, 'scripts/orion-project-agent'), '--project', ID, ...args],
    { encoding: 'utf8', env: { ...process.env, HOME: home, ORION_EXTERMINATE_GRACE_SECONDS: String(grace) } }));
  const kept = spawn(process.execPath, ['--input-type=module', '-e', `
    const { acquireLease } = await import(${JSON.stringify(join(repo, 'scripts/lib/agentic/lease.mjs'))});
    await acquireLease(${JSON.stringify(join(root, 'supervisor.lock'))}, { extra: { role: 'supervisor' } });
    process.stdout.write('holding\\n');
    setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, HOME: home } });
  t.after(() => { try { kept.kill('SIGKILL'); } catch {} });
  await new Promise(resolve => kept.stdout.once('data', resolve));
  let signal = null;
  kept.once('exit', (_code, received) => { signal = received ?? 'exited'; });

  assert.match(cliWith(2, 'exterminate').hardKill, new RegExp(`pid ${kept.pid}`));
  assert.equal(cliWith(2, 'resume').exterminateRequested, false, 'Nick changed his mind within the grace');
  let receipt = null;
  for (let i = 0; i < 60 && !receipt; i++) {
    receipt = await readFile(join(root, 'exterminate.json'), 'utf8').then(JSON.parse, () => null);
    if (!receipt) await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(receipt?.killed, false);
  assert.match(receipt?.reason ?? '', /withdrawn/);
  assert.equal(signal, null, 'the supervisor that was told to carry on is still running');
});

test('an old reaper cannot satisfy a newer exterminate early', async t => {
  const { home, root } = await project(t);
  const cliWith = (grace, ...args) => JSON.parse(execFileSync(process.execPath,
    [join(repo, 'scripts/orion-project-agent'), '--project', ID, ...args],
    { encoding: 'utf8', env: { ...process.env, HOME: home, ORION_EXTERMINATE_GRACE_SECONDS: String(grace) } }));
  const wedged = spawn(process.execPath, ['--input-type=module', '-e', `
    const { acquireLease } = await import(${JSON.stringify(join(repo, 'scripts/lib/agentic/lease.mjs'))});
    await acquireLease(${JSON.stringify(join(root, 'supervisor.lock'))}, { extra: { role: 'supervisor' } });
    process.stdout.write('holding\\n'); setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, HOME: home } });
  t.after(() => { try { wedged.kill('SIGKILL'); } catch {} });
  await new Promise(resolve => wedged.stdout.once('data', resolve));
  cliWith(1, 'exterminate');
  cliWith(1, 'resume');
  cliWith(3, 'exterminate');
  await new Promise(resolve => setTimeout(resolve, 1400));
  assert.equal(wedged.exitCode, null, 'the first token cannot kill for the second request');
  await new Promise(resolve => wedged.once('exit', resolve));
  assert.equal(wedged.signalCode, 'SIGKILL');
});

test('an unrelated state revision cannot disarm a standing exterminate', async t => {
  const { home, root } = await project(t);
  const cli = (...args) => JSON.parse(execFileSync(process.execPath,
    [join(repo, 'scripts/orion-project-agent'), '--project', ID, ...args],
    { encoding: 'utf8', env: { ...process.env, HOME: home, ORION_EXTERMINATE_GRACE_SECONDS: '1' } }));
  const wedged = spawn(process.execPath, ['--input-type=module', '-e', `
    const { acquireLease } = await import(${JSON.stringify(join(repo, 'scripts/lib/agentic/lease.mjs'))});
    await acquireLease(${JSON.stringify(join(root, 'supervisor.lock'))}, { extra: { role: 'supervisor' } });
    process.stdout.write('holding\\n'); setInterval(() => {}, 1000);
  `], { stdio: ['ignore', 'pipe', 'inherit'], env: { ...process.env, HOME: home } });
  t.after(() => { try { wedged.kill('SIGKILL'); } catch {} });
  await new Promise(resolve => wedged.stdout.once('data', resolve));
  const exterminated = cli('exterminate');
  const token = exterminated.exterminateToken;
  assert.ok(token);
  const paused = cli('pause');
  assert.equal(paused.exterminateToken, token, 'a separate operator update preserves the standing token');
  await new Promise(resolve => wedged.once('exit', resolve));
  assert.equal(wedged.signalCode, 'SIGKILL');
});
