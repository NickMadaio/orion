/*
 Every command ORION prints for Nick to type has to work when he types it.

 Runs are per project, and both CLIs answer a command without `--project` by
 looking at the legacy singleton directory — "No project-agent run exists." — so
 a printed command that drops the flag fails at exactly the moment it matters.
 These tests hold the three places that print commands (the Discord alert, the
 `commands` reference, and `orion-agent`'s own refusals) to that rule, and where
 they can, they run the printed command rather than pattern-match it.

 Every CLI here runs with HOME set to a fresh temporary directory. Nothing
 touches the real run state, the real enablement file, or Discord.
*/
import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  commandReference, discordBrief, projectCommands, projectIDFromRoot,
} from '../scripts/lib/agentic/brief.mjs';
import { registerProject } from '../scripts/lib/agentic/projects.mjs';
import {
  escalateProjectAgent, initializeProjectAgent, markEscalationNotified, mutateProjectAgent, readProjectAgent,
} from '../scripts/lib/orion-project-agent.mjs';

const exec = promisify(execFile);
const repo = resolve(import.meta.dirname, '..');
const LEGACY_ROOT = '/Users/someone/.openclaw/orion-controlled/project-agent';
const task = id => ({ id, title: `Task ${id}`, objective: 'Do one bounded thing', weight: 1,
  scope: ['tests/workspace/example.mjs'], checks: ['node-syntax'], acceptance: ['It works'] });

async function fixture(t, id = 'project-alpha') {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'orion-commands-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const base = join(home, '.openclaw/orion-controlled/project-agent');
  const plan = join(home, 'plan.json');
  await writeFile(plan, JSON.stringify({ project: 'Example', tasks: [task('one'), task('two')] }));
  const project = await registerProject(plan, { id, name: 'Example project', home: base });
  return { home, base, project };
}

// Run a repository script exactly as Nick would type it from the ORION folder,
// but against the temporary HOME.
function typed(home, line) {
  const [script, ...args] = (line.match(/"[^"]*"|\S+/g) ?? []).map(word => word.replace(/^"(.*)"$/, '$1'));
  return exec(process.execPath, [join(repo, script), ...args], { cwd: repo, env: { ...process.env, HOME: home }, timeout: 30_000 });
}

const lineAfter = (message, label) => message.split('\n').find(line => line.startsWith(label))?.slice(label.length).trim();

test('the project id is read back off a project root, and the legacy root has none', () => {
  assert.equal(projectIDFromRoot('/Users/x/.openclaw/orion-controlled/project-agent/projects/advance-orion-capabilities'), 'advance-orion-capabilities');
  assert.equal(projectIDFromRoot('/Users/x/.openclaw/orion-controlled/project-agent/projects/advance-orion-capabilities/'), 'advance-orion-capabilities');
  assert.equal(projectIDFromRoot(LEGACY_ROOT), null);
  assert.equal(projectIDFromRoot(null), null);
  // Not a project merely because a path ends in projects/<name>.
  assert.equal(projectIDFromRoot('/tmp/elsewhere/projects/project-alpha'), null);
  assert.equal(projectIDFromRoot('/Users/x/.openclaw/orion-controlled/project-agent/projects/Not_An_Id'), null);
});

test('the alert names the project in its resolve command, and the legacy alert does not', () => {
  const state = { status: 'running', revision: 7, maxAttempts: 3, tasks: [{ ...task('one'), origin: 'plan', status: 'blocked', stage: 'queued', attempts: 2 }] };
  const escalation = { id: 'esc-1', taskId: 'one', kind: 'judgement', reason: 'needs a decision', recommendAstra: false };
  const root = '/Users/x/.openclaw/orion-controlled/project-agent/projects/project-alpha';

  const forProject = discordBrief(state, { escalation, root });
  assert.equal(lineAfter(forProject, 'Resolve with:'),
    'scripts/orion-project-agent --project project-alpha resolve --revision N --id esc-1 --note "..."');
  assert.equal(lineAfter(forProject, 'N = the "revision" shown by:'), 'scripts/orion-agent --project project-alpha status');
  assert.equal(lineAfter(forProject, 'Every command:'), 'scripts/orion-agent --project project-alpha commands');

  const legacy = discordBrief(state, { escalation, root: LEGACY_ROOT });
  assert.equal(lineAfter(legacy, 'Resolve with:'), 'scripts/orion-project-agent resolve --revision N --id esc-1 --note "..."');
  assert.doesNotMatch(legacy, /--project/);

  // An Astra escalation still says how to clear it afterwards.
  const astra = discordBrief(state, { escalation: { ...escalation, recommendAstra: true }, root });
  assert.match(astra, /ASTRA REVIEW NEEDED/);
  assert.match(lineAfter(astra, 'Resolve with:'), /--project project-alpha resolve/);
});

test('a long escalation stays under 1400 bytes and never loses its commands', () => {
  const id = `p${'x'.repeat(63)}`; // the longest id projectRoot accepts
  const root = `/Users/x/.openclaw/orion-controlled/project-agent/projects/${id}`;
  const wide = '寿司🍣'.repeat(400); // multi-byte, so a byte cut through a character would show
  const state = { status: 'escalated', revision: 41, maxAttempts: 3,
    tasks: [{ ...task('one'), title: wide, origin: 'plan', status: 'blocked', stage: 'implementing', attempts: 3 }] };
  const escalation = { id: '8d4f7a52-6b0e-4c1e-9d59-0d7e3c0b9a11', taskId: 'one', kind: 'judgement',
    reason: wide.repeat(2), question: wide, recommendAstra: true };
  const journal = [
    { taskId: 'one', kind: 'checks_run', results: Array.from({ length: 60 }, (_, n) => ({ name: `check-${n}-${'y'.repeat(20)}`, ok: false })) },
    { taskId: 'one', kind: 'worker_write_refused', path: 'z'.repeat(400), reason: wide },
    ...Array.from({ length: 5 }, () => ({ taskId: 'one', kind: 'worker_turn' })),
  ];
  const briefPath = `${root}/briefs/astra-2026-09-23T01-00-00-000Z.md`;
  const message = discordBrief(state, { project: wide, escalation, journal, root, briefPath });

  assert.ok(Buffer.byteLength(message, 'utf8') <= 1400, `alert is ${Buffer.byteLength(message, 'utf8')} bytes`);
  assert.equal(lineAfter(message, 'Brief:'), briefPath);
  assert.doesNotMatch(message, /\uFFFD/);
  assert.match(message, /^ORION agent stopped — ASTRA REVIEW NEEDED/);
  assert.match(message, /^Needs: /m);
  assert.equal(lineAfter(message, 'Resolve with:'),
    `scripts/orion-project-agent --project ${id} resolve --revision N --id ${escalation.id} --note "..."`);
  assert.equal(lineAfter(message, 'Every command:'), `scripts/orion-agent --project ${id} commands`);
});

test('the alert\'s resolve command, typed as printed, resolves the escalation', async t => {
  const { home, project } = await fixture(t);
  let state = await initializeProjectAgent(project.root, [task('one'), task('two')]);
  state = await escalateProjectAgent(project.root, state.revision, { taskId: 'one', kind: 'judgement', reason: 'pick an API shape' });
  const escalation = state.escalations[0];
  const message = discordBrief(state, { escalation, root: project.root });
  // What the supervisor does straight after a delivered alert. It is why the
  // alert cannot carry a concrete revision: this one is already stale.
  await markEscalationNotified(project.root, state.revision, escalation.id);

  const status = JSON.parse((await typed(home, lineAfter(message, 'N = the "revision" shown by:'))).stdout);
  assert.notEqual(status.revision, state.revision);
  const resolveLine = lineAfter(message, 'Resolve with:')
    .replace('--revision N', `--revision ${status.revision}`)
    .replace('--note "..."', '--note "shape agreed"');
  await typed(home, resolveLine);

  const after = await readProjectAgent(project.root);
  assert.ok(after.escalations.find(item => item.id === escalation.id).resolvedAt);
});

// Entries from the reference itself, so the test types what Nick would read.
const referenced = (id, word) => projectCommands(id).flatMap(group => group.entries)
  .map(entry => entry.command).find(command => command.split(' ')[3] === word);

test('the reference\'s steer command, typed with N from status, queues the instruction', async t => {
  const { home, project } = await fixture(t);
  await initializeProjectAgent(project.root, [task('one')]);
  const { revision } = JSON.parse((await typed(home, referenced(project.id, 'status'))).stdout);
  await typed(home, referenced(project.id, 'steer').replace('--revision N', `--revision ${revision}`).replace('"..."', '"prefer the smaller change"'));
  assert.deepEqual((await readProjectAgent(project.root)).steering.map(item => item.text), ['prefer the smaller change']);
});

/*
 The halts as printed carry no revision: stopping must never fail because the
 run moved between reading status and typing the command. So they are typed
 here exactly as printed, with nothing substituted.
*/
test('the reference\'s halt commands, typed exactly as printed, pause, stop, exterminate and resume', async t => {
  const { home, project } = await fixture(t);
  await initializeProjectAgent(project.root, [task('one')]);
  const flags = async () => {
    const { pauseRequested, stopRequested, exterminateRequested } = await readProjectAgent(project.root);
    return { pauseRequested, stopRequested, exterminateRequested };
  };
  const clear = { pauseRequested: false, stopRequested: false, exterminateRequested: false };
  for (const [word, expected] of [
    ['pause', { ...clear, pauseRequested: true }],
    ['resume', clear],
    ['stop', { ...clear, stopRequested: true }],
    ['resume', clear],
    ['exterminate', { ...clear, stopRequested: true, exterminateRequested: true }],
    ['resume', clear],
  ]) {
    await typed(home, referenced(project.id, word));
    assert.deepEqual(await flags(), expected, `after ${word}`);
  }
});

test('`commands` prints every command with the id filled in, before any run exists, and creates nothing', async t => {
  const { home, project } = await fixture(t);
  const { stdout } = await typed(home, `scripts/orion-agent --project ${project.id} commands`);

  for (const expected of [
    `scripts/orion-agent --project ${project.id} status`,
    `scripts/orion-agent --project ${project.id} brief`,
    `scripts/orion-agent --project ${project.id} commands`,
    `scripts/orion-projects launch ${project.id} --until-stopped`,
    `scripts/orion-project-agent --project ${project.id} pause`,
    `scripts/orion-project-agent --project ${project.id} stop`,
    `scripts/orion-project-agent --project ${project.id} exterminate`,
    `scripts/orion-project-agent --project ${project.id} resume`,
    `scripts/orion-project-agent --project ${project.id} steer --revision N --text "..."`,
    `scripts/orion-project-agent --project ${project.id} resolve --revision N --id ESCALATION_ID --note "..."`,
    'scripts/orion-projects preflight',
    ...['status', 'pause', 'stop', 'exterminate', 'resume'].map(word => `agent ${word} ${project.id}`),
  ]) assert.ok(stdout.includes(expected), `missing: ${expected}`);
  assert.match(stdout, /"Example project"/);
  assert.match(stdout, new RegExp(`cd ${repo.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`));

  // Every Mac command line names a real script, and names this project unless
  // it is the one machine-wide check.
  const commandLines = stdout.split('\n').filter(line => /^ {2}scripts\//.test(line)).map(line => line.trim());
  assert.ok(commandLines.length >= 11);
  for (const line of commandLines) {
    assert.ok(existsSync(join(repo, line.split(' ')[0])), `no such script: ${line}`);
    assert.ok(line.includes(project.id) || line === 'scripts/orion-projects preflight', `no project id: ${line}`);
  }
  // Nothing was initialized, enabled or created on the way.
  assert.equal(existsSync(join(project.root, 'state.json')), false);
  assert.equal(existsSync(join(home, '.openclaw/orion-controlled/agentic-config.json')), false);
});

test('`commands` without --project prints the legacy forms, and an unknown id is refused in words', async t => {
  const { home } = await fixture(t);
  const { stdout } = await typed(home, 'scripts/orion-agent commands');
  const commandLines = stdout.split('\n').filter(line => /^ {2}scripts\//.test(line));
  assert.ok(commandLines.some(line => line.trim() === 'scripts/orion-project-agent stop'));
  assert.ok(commandLines.some(line => line.trim() === 'scripts/orion-agent run --until-stopped'));
  assert.ok(commandLines.every(line => !line.includes('--project')));
  assert.match(stdout, /scripts\/orion-projects list/);

  const refused = await typed(home, 'scripts/orion-agent --project no-such-project commands').catch(error => error);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /no saved project called "no-such-project".*scripts\/orion-projects list/);
  assert.doesNotMatch(refused.stderr, /at .*\.mjs:\d+/); // words, not a stack trace
});

test('the reference and OPERATING.md list the same commands', async () => {
  const doc = await readFile(join(repo, 'docs/agentic/OPERATING.md'), 'utf8');
  const entries = projectCommands('id-placeholder').flatMap(group => group.entries.map(entry => entry.command));
  assert.ok(entries.length >= 16);
  for (const command of entries) {
    const documented = command.replace('id-placeholder', '<id>');
    assert.ok(doc.includes(documented), `OPERATING.md is missing: ${documented}`);
  }
  assert.match(doc, /orion-agent --project <id> commands/);
  assert.ok(commandReference({ projectID: 'project-alpha' }).includes('scripts/orion-project-agent --project project-alpha exterminate'));
});

test('run\'s standing-stop refusal prints a resume command that carries --project', async t => {
  const { home, project } = await fixture(t);
  // An enabled config in the TEMPORARY home, pointed at a closed loopback port:
  // were the refusal ever skipped, no model could be reached.
  const controlled = join(home, '.openclaw/orion-controlled');
  await writeFile(join(controlled, 'agentic-config.json'), JSON.stringify({ enabled: true, endpoint: 'http://127.0.0.1:9' }));
  const state = await initializeProjectAgent(project.root, [task('one')]);
  await writeFile(join(project.root, 'run.json'), JSON.stringify({ project: 'Example', runId: state.runId,
    worktree: join(project.root, 'worktree'), repo: join(home, 'no-such-repo'), baseRef: 'HEAD' }));
  await mutateProjectAgent(project.root, state.revision, current => { current.stopRequested = true; });
  assert.equal((await readProjectAgent(project.root)).stopRequested, true);

  const refused = await typed(home, `scripts/orion-agent --project ${project.id} run --hours 1`).catch(error => error);
  assert.equal(refused.code, 1);
  assert.match(refused.stderr, /stopped by an operator/);
  assert.ok(refused.stderr.includes(`Clear it with: scripts/orion-project-agent --project ${project.id} resume`), refused.stderr);
  assert.ok(refused.stderr.includes(`scripts/orion-projects launch ${project.id} --until-stopped`), refused.stderr);
  // Refused before the one-project-at-a-time lock was ever taken.
  assert.equal(existsSync(join(controlled, 'project-agent/active-project.lock')), false);
});

test('a project that was never launched says how to start it, with its id, from run, status and brief', async t => {
  const { home, project } = await fixture(t);
  const controlled = join(home, '.openclaw/orion-controlled');
  await mkdir(controlled, { recursive: true });
  await writeFile(join(controlled, 'agentic-config.json'), JSON.stringify({ enabled: true, endpoint: 'http://127.0.0.1:9' }));
  for (const command of ['run --hours 1', 'status', 'brief']) {
    const refused = await typed(home, `scripts/orion-agent --project ${project.id} ${command}`).catch(error => error);
    assert.equal(refused.code, 1, command);
    assert.ok(refused.stderr.includes(`has not been started yet; start it with: scripts/orion-projects launch ${project.id} --until-stopped`), `${command}: ${refused.stderr}`);
  }
  assert.equal(existsSync(join(project.root, 'state.json')), false);
});
