/*
 `agent …` over Discord must reach the project run that is actually running.

 The verb used to read one hard-coded state file from before runs were per
 project, so while a project ran it answered "no development run exists" and
 every halt was refused before it reached the controller. These tests drive the
 REAL `orion-remote handle` path -- sender allowlist, shape check, dispatcher,
 audit -- as a subprocess with HOME pointed at a temp directory, so nothing here
 can touch the live run, the live remote state or the live Discord channel.

 The operator CLI is a stub in most tests (ORION_REPO is orion-remote's own
 seam for exactly this): it records its argv and applies the halt to the fake
 state, which is what lets a test prove the reply was built from the state read
 AFTER the action. One test at the end drives the real controller instead.
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const exec = promisify(execFile);
const REPO = dirname(dirname(fileURLToPath(import.meta.url)));
const REMOTE = join(REPO, 'scripts/orion-remote');

// CommonJS on purpose: it runs from a directory with no package.json, and it
// must not depend on anything the real controller imports.
const STUB_OPERATOR = `
const fs = require('fs');
const path = require('path');
const argv = process.argv.slice(2);
const home = process.env.HOME;
fs.appendFileSync(path.join(home, 'operator-calls.jsonl'),
  JSON.stringify({ node: process.argv[0], script: __filename, argv }) + '\\n');
if (process.env.STUB_OPERATOR_FAIL) { process.stderr.write(process.env.STUB_OPERATOR_FAIL); process.exit(1); }
const base = path.join(home, '.openclaw/orion-controlled/project-agent');
const at = argv.indexOf('--project');
const root = at < 0 ? base : path.join(base, 'projects', argv[at + 1]);
const action = (at < 0 ? argv : [...argv.slice(0, at), ...argv.slice(at + 2)])[0];
const file = path.join(root, 'state.json');
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
const change = {
  pause: { pauseRequested: true, status: state.activeTask ? state.status : 'paused' },
  stop: { stopRequested: true },
  exterminate: { stopRequested: true, exterminateRequested: true },
  resume: { pauseRequested: false, stopRequested: false, exterminateRequested: false, status: 'ready' },
}[action];
const next = { ...state, revision: (state.revision ?? 0) + 1, ...change };
fs.writeFileSync(file, JSON.stringify(next));
process.stdout.write(JSON.stringify(next));
`;

// A brain that only records that it was asked. No `agent` command may fall
// through to the model, and several tests assert this file never appears.
const STUB_BRAIN = `#!/bin/sh
echo asked >> "$HOME/brain-calls"
echo '{"runId":"stub","status":"ok","result":{"payloads":[{"text":"STUBBRAIN"}]}}'
`;

const runState = (overrides = {}) => ({
  version: 3, revision: 4, status: 'ready', activeTask: null,
  pauseRequested: false, stopRequested: false, exterminateRequested: false,
  tasks: [{ id: 't1', title: 'First task', status: 'accepted' }, { id: 't2', title: 'Second task', status: 'queued' }],
  escalations: [],
  ...overrides,
});

async function fakeRepo(dir, { git = false } = {}) {
  await mkdir(join(dir, 'scripts/lib'), { recursive: true });
  await writeFile(join(dir, 'scripts/lib/orion-project-agent.mjs'), '// stand-in: presence is what the locator checks\n');
  await writeFile(join(dir, 'scripts/orion-project-agent'), STUB_OPERATOR, { mode: 0o755 });
  if (git) await mkdir(join(dir, '.git'));
  return dir;
}

async function fixture(t) {
  // realpath: macOS tmpdir is under /var, a symlink, and the real controller
  // refuses a project directory whose realpath differs from its path.
  const home = await realpath(await mkdtemp(join(tmpdir(), 'orion-remote-agent-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const agentHome = join(home, '.openclaw/orion-controlled/project-agent');
  await mkdir(join(agentHome, 'projects'), { recursive: true });
  const repo = await fakeRepo(join(home, 'fake-repo'));
  const brain = join(home, 'fake-openclaw');
  await writeFile(brain, STUB_BRAIN, { mode: 0o755 });
  return { home, agentHome, repo, brain };
}

async function project(ctx, id, state, { name = `Project ${id}` } = {}) {
  const root = join(ctx.agentHome, 'projects', id);
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'project.json'), JSON.stringify({ version: 1, id, name, planFile: 'plan.md', createdAt: new Date().toISOString() }));
  if (state) await writeFile(join(root, 'state.json'), JSON.stringify(state));
  return root;
}

// The owner record lease.mjs writes, as `orion-agent run --project <id>` holds it.
async function holdFleetLock(ctx, projectID) {
  const lock = join(ctx.agentHome, 'active-project.lock');
  await mkdir(lock, { recursive: true });
  await writeFile(join(lock, 'owner.json'), JSON.stringify({ pid: process.pid, bootId: 'x', startedAt: 'x', acquiredAt: new Date().toISOString(), role: 'project-run', projectID }));
}

// A minimal environment rather than process.env: nothing from the shell running
// the tests (a real ORION_REPO, a reply channel) may leak into the child.
async function send(ctx, text, { from = 'nick', allow = 'nick', script = REMOTE, env = {} } = {}) {
  const childEnv = { PATH: process.env.PATH, HOME: ctx.home, ORION_REMOTE_ALLOW: allow, ORION_BRAIN_BIN: ctx.brain, ORION_REPO: ctx.repo, ...env };
  for (const [key, value] of Object.entries(childEnv)) if (value === undefined) delete childEnv[key];
  try {
    const { stdout } = await exec(process.execPath, [script, 'handle', '--from', from, '--', ...text.split(' ')], { env: childEnv });
    return { code: 0, out: stdout.trim() };
  } catch (error) {
    return { code: error.code, out: String(error.stdout ?? '').trim(), err: String(error.stderr ?? '') };
  }
}

const calls = async (ctx) => {
  try { return (await readFile(join(ctx.home, 'operator-calls.jsonl'), 'utf8')).split('\n').filter(Boolean).map((line) => JSON.parse(line)); }
  catch (error) { if (error.code === 'ENOENT') return []; throw error; }
};
const brainAsked = async (ctx) => readFile(join(ctx.home, 'brain-calls'), 'utf8').then(() => true, () => false);
const stateOf = async (ctx, id) => JSON.parse(await readFile(join(ctx.agentHome, 'projects', id, 'state.json'), 'utf8'));
const auditLines = async (ctx) => (await readFile(join(ctx.home, '.openclaw/orion-controlled/remote-audit.jsonl'), 'utf8'))
  .split('\n').filter(Boolean).map((line) => JSON.parse(line));

test('the fleet lock names the project a halt reaches, and the reply is the state after the halt', async (t) => {
  const ctx = await fixture(t);
  await project(ctx, 'alpha', runState());
  await project(ctx, 'beta', runState(), { name: 'Beta work' });
  await holdFleetLock(ctx, 'beta');

  const status = await send(ctx, 'agent status');
  assert.equal(status.code, 0);
  assert.match(status.out, /^Orion \| AGENT READY · beta\n- Beta work\n- 1\/2 tasks accepted/);
  assert.deepEqual(await calls(ctx), [], 'status is read in-process and never needs the controller');

  const paused = await send(ctx, 'agent pause');
  assert.equal(paused.code, 0, paused.out);
  assert.deepEqual((await calls(ctx)).map((call) => call.argv), [['--project', 'beta', 'pause']]);
  // READY before, PAUSED after: the header can only say PAUSED if it was re-read.
  assert.match(paused.out, /^Orion \| AGENT PAUSED · beta\n- pause recorded/);
  assert.equal((await stateOf(ctx, 'alpha')).pauseRequested, false, 'the project that is not running is untouched');
  assert.equal(await brainAsked(ctx), false);
});

test('with nothing running, the one project that has a run is the target', async (t) => {
  const ctx = await fixture(t);
  await project(ctx, 'alpha', runState({ status: 'running', activeTask: 't2' }));
  await project(ctx, 'beta', null); // registered, never launched: no run to stop

  const stopped = await send(ctx, 'agent stop');
  assert.equal(stopped.code, 0, stopped.out);
  assert.deepEqual((await calls(ctx)).map((call) => call.argv), [['--project', 'alpha', 'stop']]);
  assert.match(stopped.out, /^Orion \| AGENT RUNNING · alpha/);
  // RUNNING alone would read as the stop being ignored, so the standing request is spelled out.
  assert.match(stopped.out, /\n- stop requested\n/);
  assert.match(stopped.out, /\n- on t2: Second task\n/);
  assert.match(stopped.out, /\n- supervisor not running$/);
});

test('several runs and nothing running: the reply lists them and nothing is halted', async (t) => {
  const ctx = await fixture(t);
  await project(ctx, 'alpha', runState({ status: 'paused' }));
  await project(ctx, 'beta', runState({ status: 'completed' }));

  const stop = await send(ctx, 'agent stop');
  assert.equal(stop.code, 1);
  assert.match(stop.out, /2 projects have runs, none is running/);
  assert.match(stop.out, /\n- alpha: PAUSED\n- beta: COMPLETED\n/);
  assert.match(stop.out, /Nothing was changed\. Name one: agent stop <project id>$/);
  assert.deepEqual(await calls(ctx), []);

  const status = await send(ctx, 'agent status');
  assert.equal(status.code, 0, 'listing the runs IS an answer to status');
  assert.match(status.out, /Name one for detail: agent status <project id>$/);
  assert.equal(await brainAsked(ctx), false);
});

test('an explicit project id wins over the running one', async (t) => {
  const ctx = await fixture(t);
  await project(ctx, 'alpha', runState());
  await project(ctx, 'beta', runState());
  await holdFleetLock(ctx, 'beta');

  const reply = await send(ctx, 'agent stop alpha');
  assert.equal(reply.code, 0, reply.out);
  assert.deepEqual((await calls(ctx)).map((call) => call.argv), [['--project', 'alpha', 'stop']]);
  assert.match(reply.out, /· alpha\n/);
  assert.equal((await stateOf(ctx, 'beta')).stopRequested, false);

  const status = await send(ctx, 'agent status alpha');
  assert.match(status.out, /^Orion \| AGENT READY · alpha/);
  assert.match(status.out, /\n- stop requested\n/);
});

test('an id that names no project directory is refused before anything runs', async (t) => {
  const ctx = await fixture(t);
  const alpha = await project(ctx, 'alpha', runState());
  await symlink(alpha, join(ctx.agentHome, 'projects', 'alias'));

  for (const id of ['gamma', 'alpha/../alpha', 'alias', 'x']) {
    const reply = await send(ctx, `agent stop ${id}`);
    assert.equal(reply.code, 1, `${id}: ${reply.out}`);
    assert.equal(reply.out, `no project called ${id}`);
  }
  // A third argument is not a looser grammar, it is a usage error.
  const extra = await send(ctx, 'agent stop alpha now');
  assert.equal(extra.code, 1);
  assert.match(extra.out, /^agent needs one of status, pause, resume, stop, exterminate/);

  assert.deepEqual(await calls(ctx), [], 'no refused id reached the controller');
  assert.equal(await brainAsked(ctx), false, 'a wrong project id is a command mistake, not conversation');
  // Four shape refusals by the dispatcher, and the usage error rejected by the parser.
  const decisions = (await auditLines(ctx)).map((line) => line.decision);
  assert.deepEqual(decisions, ['refused', 'refused', 'refused', 'refused', 'rejected']);
});

test('a fleet lock naming something that is not a project is ignored, not obeyed', async (t) => {
  const ctx = await fixture(t);
  await project(ctx, 'alpha', runState());
  await holdFleetLock(ctx, '../../outside');

  const reply = await send(ctx, 'agent pause');
  assert.equal(reply.code, 0, reply.out);
  assert.deepEqual((await calls(ctx)).map((call) => call.argv), [['--project', 'alpha', 'pause']]);
});

test('exterminate reaches the operator CLI with --project, without --revision, through this node', async (t) => {
  const ctx = await fixture(t);
  await project(ctx, 'alpha', runState({ status: 'running', activeTask: 't2' }));
  await holdFleetLock(ctx, 'alpha');
  // A live heartbeat, as the supervisor writes every ten seconds.
  await writeFile(join(ctx.agentHome, 'projects/alpha/heartbeat.json'), JSON.stringify({ at: new Date().toISOString(), phase: 'loop' }));

  const reply = await send(ctx, 'agent exterminate');
  assert.equal(reply.code, 0, reply.out);
  const [call] = await calls(ctx);
  assert.deepEqual(call.argv, ['--project', 'alpha', 'exterminate']);
  // Not the script's `#!/usr/bin/env node`: launchd's PATH has no node on it.
  assert.equal(call.node, process.execPath);
  assert.equal(call.script, join(ctx.repo, 'scripts/orion-project-agent'));
  assert.match(reply.out, /^Orion \| AGENT RUNNING · alpha\n- exterminate recorded; the supervisor abandons the model call in flight/);
  assert.match(reply.out, /\n- exterminate requested\n/);
  assert.match(reply.out, /\n- supervisor live$/);
  assert.equal((await stateOf(ctx, 'alpha')).exterminateRequested, true);

  const [line] = (await auditLines(ctx)).filter((entry) => entry.verb === 'agent');
  assert.equal(line.decision, 'accepted');
  assert.equal(line.project, 'alpha');
  assert.equal(line.resolvedBy, 'running');
  assert.equal(line.operator, join(ctx.repo, 'scripts/orion-project-agent'));
});

test('the legacy single root is the last fallback, and is driven without --project', async (t) => {
  const ctx = await fixture(t);
  await writeFile(join(ctx.agentHome, 'state.json'), JSON.stringify(runState()));

  const reply = await send(ctx, 'agent pause');
  assert.equal(reply.code, 0, reply.out);
  assert.deepEqual((await calls(ctx)).map((call) => call.argv), [['pause']]);
  assert.match(reply.out, /^Orion \| AGENT PAUSED\n/);
});

test('no run anywhere says so, and halts are recorded as refused', async (t) => {
  const ctx = await fixture(t);
  await project(ctx, 'alpha', null);

  const status = await send(ctx, 'agent status');
  assert.equal(status.code, 0);
  assert.equal(status.out, 'Orion | AGENT\n- no development run exists');
  const named = await send(ctx, 'agent stop alpha');
  assert.equal(named.code, 1);
  assert.match(named.out, /^Orion \| AGENT · alpha\n- no run yet/);
  assert.deepEqual(await calls(ctx), []);
});

test('resume from the local process is refused; from a person it goes through', async (t) => {
  const ctx = await fixture(t);
  await project(ctx, 'alpha', runState({ status: 'paused', pauseRequested: true }));

  const local = await send(ctx, 'agent resume', { from: 'local', allow: 'local,nick' });
  assert.equal(local.code, 1);
  assert.match(local.out, /a resume has to come from a person/);
  assert.deepEqual(await calls(ctx), []);
  // The safe direction stays open to the local process.
  const localStop = await send(ctx, 'agent stop', { from: 'local', allow: 'local,nick' });
  assert.equal(localStop.code, 0, localStop.out);

  const person = await send(ctx, 'agent resume', { allow: 'local,nick' });
  assert.equal(person.code, 0, person.out);
  assert.deepEqual((await calls(ctx)).map((call) => call.argv), [['--project', 'alpha', 'stop'], ['--project', 'alpha', 'resume']]);
  assert.match(person.out, /^Orion \| AGENT READY · alpha\n- halt cleared, but no supervisor is running\. .*scripts\/orion-projects launch alpha --until-stopped\b/);
});

test('LOCK ORION still permits phone status and halts, but blocks resume', async t => {
  const ctx = await fixture(t);
  await project(ctx, 'alpha', runState({ status: 'running', activeTask: 't2' }));
  await holdFleetLock(ctx, 'alpha');
  await writeFile(join(ctx.home, '.openclaw/orion-controlled/lock.json'), JSON.stringify({ locked: true }));
  const status = await send(ctx, 'agent status');
  assert.equal(status.code, 0, status.out);
  const stop = await send(ctx, 'agent stop');
  assert.equal(stop.code, 0, stop.out);
  assert.equal((await stateOf(ctx, 'alpha')).stopRequested, true);
  const resume = await send(ctx, 'agent resume');
  assert.equal(resume.code, 1);
  assert.match(resume.out, /locked/);
});

test('the local queue cannot forge a remote sender', async t => {
  const ctx = await fixture(t);
  await project(ctx, 'alpha', runState({ status: 'paused', pauseRequested: true }));
  await assert.rejects(exec(process.execPath,
    [REMOTE, 'inject', '--from', 'nick', '--', 'agent', 'resume', 'alpha'],
    { env: { PATH: process.env.PATH, HOME: ctx.home, ORION_REMOTE_ALLOW: 'nick' } }), /impersonate/);
  assert.equal((await stateOf(ctx, 'alpha')).pauseRequested, true);
});

test('concurrent authenticated messages preserve both replay/rate records', async t => {
  const ctx = await fixture(t);
  await project(ctx, 'alpha', runState());
  const replies = await Promise.all([send(ctx, 'agent status alpha'), send(ctx, 'agent status alpha')]);
  assert.deepEqual(replies.map(item => item.code), [0, 0]);
  const inbound = JSON.parse(await readFile(join(ctx.home, '.openclaw/orion-controlled/remote-inbound.json'), 'utf8'));
  assert.equal(inbound.hits.length, 2);
});

test('a slow brain turn never blocks an emergency halt', async t => {
  const ctx = await fixture(t);
  await project(ctx, 'alpha', runState({ status: 'running', activeTask: 't2' }));
  await holdFleetLock(ctx, 'alpha');
  const slowBrain = join(ctx.home, 'slow-brain');
  await writeFile(slowBrain, '#!/bin/sh\nsleep 1\necho \'{"runId":"slow","status":"ok","result":{"payloads":[{"text":"done"}]}}\'\n', { mode: 0o755 });
  const chat = send(ctx, 'hello Orion', { env: { ORION_BRAIN_BIN: slowBrain } });
  await new Promise(resolve => setTimeout(resolve, 100));
  const started = Date.now();
  const halted = await send(ctx, 'agent exterminate');
  assert.equal(halted.code, 0, halted.out);
  assert.ok(Date.now() - started < 750, 'the halt does not wait for the brain turn');
  assert.equal((await stateOf(ctx, 'alpha')).exterminateRequested, true);
  assert.equal((await chat).code, 0);
});

test('the Discord bridge authenticates each message directly instead of draining an impersonable queue', async () => {
  const bridge = await readFile(join(REPO, 'scripts/orion-remote-bridge'), 'utf8');
  assert.match(bridge, /REMOTE, "handle", "--from", authorID, "--id", messageID/);
  assert.match(bridge, /error\.code === 1 && String\(error\.stdout/);
  assert.doesNotMatch(bridge, /REMOTE, "inject"/);
  assert.doesNotMatch(bridge, /REMOTE, "poll"/);
});

test('a controller refusal is relayed in one line, without this Mac\'s paths', async (t) => {
  const ctx = await fixture(t);
  await project(ctx, 'alpha', runState({ status: 'completed' }));
  const stack = 'file:///Users/someone/Desktop/ORION/scripts/orion-project-agent:40\n  const x = 1;\n\nError: run completed\n    at steer (file:///Users/someone/Desktop/ORION/scripts/lib/orion-project-agent.mjs:9:9)\n';

  const reply = await send(ctx, 'agent stop', { env: { STUB_OPERATOR_FAIL: stack } });
  assert.equal(reply.code, 1);
  assert.equal(reply.out, 'Orion | AGENT COMPLETED · alpha\n- could not stop: run completed');

  const plain = await send(ctx, 'agent pause', { env: { STUB_OPERATOR_FAIL: 'Controller is busy; refresh and retry.\n' } });
  assert.match(plain.out, /could not pause: Controller is busy; refresh and retry\.$/);
  assert.doesNotMatch(reply.out + plain.out, /\/Users\//);
});

/*
 The live bridge runs an INSTALLED COPY under ~/.openclaw/orion-remote, and
 after a re-install that copy carries its own snapshot of the controller. The
 halt must still go through the repository -- found at ~/Desktop/ORION, the
 convention the rest of the repo uses -- because the snapshot may be stale.
*/
async function installedCopy(ctx) {
  const scripts = join(ctx.home, '.openclaw/orion-remote/scripts');
  await fakeRepo(join(ctx.home, '.openclaw/orion-remote')); // the snapshot, deliberately present
  await copyFile(REMOTE, join(scripts, 'orion-remote'));
  return join(scripts, 'orion-remote');
}

test('the installed copy drives the repository controller, never its own snapshot', async (t) => {
  const ctx = await fixture(t);
  await project(ctx, 'alpha', runState());
  const script = await installedCopy(ctx);
  const desktop = await fakeRepo(join(ctx.home, 'Desktop/ORION'), { git: true });

  const reply = await send(ctx, 'agent stop', { script, env: { ORION_REPO: undefined } });
  assert.equal(reply.code, 0, reply.out);
  const [call] = await calls(ctx);
  assert.equal(call.script, join(desktop, 'scripts/orion-project-agent'));
  assert.deepEqual(call.argv, ['--project', 'alpha', 'stop']);
});

/*
 THE LIVE BRIDGE'S CASE. launchd cannot read ~/Desktop, so on the real bridge the
 repository is always blocked — and the installer has put a complete copy of the
 controller beside the bridge. That copy must carry the halt: without it, no
 halt sent from a phone could ever land.
*/
test('when the repository is unreachable, the installed controller beside the bridge carries the halt', async (t) => {
  const ctx = await fixture(t);
  await project(ctx, 'alpha', runState());
  const script = await installedCopy(ctx);
  const desktop = await fakeRepo(join(ctx.home, 'Desktop/ORION'), { git: true });
  await chmod(join(desktop, 'scripts'), 0o000);
  try {
    const stopped = await send(ctx, 'agent stop', { script, env: { ORION_REPO: undefined } });
    assert.equal(stopped.code, 0, stopped.out);
    const [call] = await calls(ctx);
    assert.equal(call.script, join(ctx.home, '.openclaw/orion-remote/scripts/orion-project-agent'),
      'the installed controller ran, because the repository could not be reached');
    assert.deepEqual(call.argv, ['--project', 'alpha', 'stop']);
  } finally {
    await chmod(join(desktop, 'scripts'), 0o755);
  }
  assert.equal((await stateOf(ctx, 'alpha')).stopRequested, true);
});

test('with no reachable repository and no installed controller, the reply says which', async (t) => {
  const ctx = await fixture(t);
  await project(ctx, 'alpha', runState());
  // An installed bridge WITHOUT the controller beside it — an install that
  // predates the agent verb.
  const scripts = join(ctx.home, '.openclaw/orion-remote/scripts');
  await mkdir(scripts, { recursive: true });
  await copyFile(REMOTE, join(scripts, 'orion-remote'));
  const script = join(scripts, 'orion-remote');

  const missing = await send(ctx, 'agent stop', { script, env: { ORION_REPO: undefined } });
  assert.equal(missing.code, 1);
  assert.match(missing.out, /could not stop: the ORION repository was not found/);

  const desktop = await fakeRepo(join(ctx.home, 'Desktop/ORION'), { git: true });
  await chmod(join(desktop, 'scripts'), 0o000);
  try {
    const blocked = await send(ctx, 'agent stop', { script, env: { ORION_REPO: undefined } });
    assert.equal(blocked.code, 1);
    assert.match(blocked.out, /could not stop: macOS privacy is keeping the remote bridge out of ~\/Desktop/);
  } finally {
    await chmod(join(desktop, 'scripts'), 0o755);
  }
  assert.deepEqual(await calls(ctx), []);
  assert.equal((await stateOf(ctx, 'alpha')).stopRequested, false);
});

/*
 The real controller, end to end: registration and state from the repository's
 own library, and the halt through the repository's own scripts/orion-project-agent
 (found because this checkout has a .git). This is the test that fails if the
 argv this file sends and the argv the controller accepts ever drift apart.
*/
test('against the real operator CLI: stop and exterminate land on the named project only', async (t) => {
  const ctx = await fixture(t);
  const { registerProject } = await import('../scripts/lib/agentic/projects.mjs');
  const { initializeProjectAgent, readProjectAgent } = await import('../scripts/lib/orion-project-agent.mjs');
  const task = { id: 'remote-task', title: 'Remote task', objective: 'Do one thing', weight: 1,
    scope: ['tests/workspace/example.mjs'], checks: ['node-syntax'], acceptance: ['It works'] };
  const plan = join(ctx.home, 'plan.json');
  await writeFile(plan, JSON.stringify({ project: 'Remote', tasks: [task] }));
  const one = await registerProject(plan, { id: 'project-one', home: ctx.agentHome });
  const two = await registerProject(plan, { id: 'project-two', home: ctx.agentHome });
  await initializeProjectAgent(one.root, [task]);
  await initializeProjectAgent(two.root, [task]);
  await holdFleetLock(ctx, 'project-one');

  const stop = await send(ctx, 'agent stop', { env: { ORION_REPO: undefined } });
  assert.equal(stop.code, 0, `${stop.out}\n${stop.err ?? ''}`);
  assert.match(stop.out, /^Orion \| AGENT READY · project-one\n- stop recorded/);
  assert.equal((await readProjectAgent(one.root)).stopRequested, true);
  assert.equal((await readProjectAgent(two.root)).stopRequested, false);

  const ext = await send(ctx, 'agent exterminate project-two', { env: { ORION_REPO: undefined } });
  assert.equal(ext.code, 0, `${ext.out}\n${ext.err ?? ''}`);
  assert.equal((await readProjectAgent(two.root)).exterminateRequested, true);
  assert.equal((await readProjectAgent(one.root)).exterminateRequested, false);
});
