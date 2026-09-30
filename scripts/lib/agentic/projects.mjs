import { mkdir, readFile, writeFile, readdir, lstat, realpath, rename, rm, access } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { loadAgentPlan, briefsDirectory } from './plan.mjs';
import { inspectLease } from './lease.mjs';
import { auditContractScope } from './boundary.mjs';
import { validateAwakeOptions } from './awake.mjs';

export const PROJECT_HOME = join(homedir(), '.openclaw/orion-controlled/project-agent');
export function projectRoot(id, home = PROJECT_HOME) {
  if (typeof id !== 'string' || !/^[a-z0-9][a-z0-9-]{1,63}$/.test(id)) throw new Error('Invalid project id');
  return join(home, 'projects', id);
}
// `launchOptions` is optional and stays version 1: records written before it
// existed read as the defaults (keep-awake on, display may sleep, no nudge). A
// record that HAS it must be valid — a corrupt value is refused by name rather
// than quietly read as "keep-awake off" on the night it mattered.
export async function readProject(id, home = PROJECT_HOME) {
  const root = projectRoot(id, home);
  if ((await lstat(root)).isSymbolicLink() || await realpath(root) !== resolve(root)) throw new Error('Project directory must not be a symlink');
  const p = JSON.parse(await readFile(join(root, 'project.json'), 'utf8'));
  if (p.version !== 1 || p.id !== id || typeof p.name !== 'string' || !p.name.trim() ||
      !['plan.md','plan.json'].includes(p.planFile)) throw new Error('Invalid project record');
  let launchOptions;
  try { launchOptions = validateAwakeOptions(p.launchOptions ?? undefined); }
  catch (e) { throw new Error(`Invalid project launch options: ${e.message}`); }
  return { ...p, launchOptions, root, planPath: join(root, p.planFile) };
}
// Saved by `launch` so the next launch — from the app or the CLI — starts from
// the same choices. Written to a temporary file and renamed, so the app, which
// polls project.json, never reads half a record.
export async function saveProjectLaunchOptions(id, options, home = PROJECT_HOME) {
  const launchOptions = validateAwakeOptions(options);
  const project = await readProject(id, home); // Refuses symlinks and invalid records before writing.
  const file = join(project.root, 'project.json');
  const record = JSON.parse(await readFile(file, 'utf8'));
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, JSON.stringify({ ...record, launchOptions }, null, 2), { mode: 0o600, flag: 'wx' });
  try { await rename(temporary, file); }
  catch (e) { await rm(temporary, { force: true }); throw e; }
  return readProject(id, home);
}
/*
 The briefs beside a plan are part of what was approved to run, so they are
 snapshotted with it: `plan.md` gets `plan.briefs/`, the same convention the
 loader reads (plan.mjs). Written file by file into a fresh directory; `flag: wx`
 on each so nothing is ever overwritten in place.
*/
async function writeBriefSnapshot(directory, briefs) {
  await mkdir(directory, { mode: 0o700 });
  if (briefs.common) await writeFile(join(directory, 'common.md'), `${briefs.common}\n`, { mode: 0o600, flag: 'wx' });
  for (const [id, text] of Object.entries(briefs.byTask)) {
    await writeFile(join(directory, `${id}.md`), `${text}\n`, { mode: 0o600, flag: 'wx' });
  }
}

export async function registerProject(file, { name, id = `project-${randomUUID()}`, home = PROJECT_HOME } = {}) {
  const markdown = /\.md$/i.test(file);
  const plan = await loadAgentPlan(resolve(file));
  const source = plan.source;
  const findings = plan.tasks.flatMap(t => auditContractScope(t).findings);
  if (findings.length) throw new Error('Plan contains protected or invalid write scopes');
  const title = (name ?? plan.project).trim();
  if (!title || title.length > 160) throw new Error('Project name must be 1–160 characters');
  const root = projectRoot(id, home);
  await mkdir(join(home, 'projects'), { recursive: true, mode: 0o700 });
  await mkdir(root, { mode: 0o700 }); // Exclusive: never overwrite another project.
  const record = { version: 1, id, name: title, createdAt: new Date().toISOString(),
    planFile: markdown ? 'plan.md' : 'plan.json', taskCount: plan.tasks.length, sourcePath: resolve(file) };
  await writeFile(join(root, record.planFile), source, { mode: 0o600, flag: 'wx' });
  if (plan.briefs) await writeBriefSnapshot(briefsDirectory(join(root, record.planFile)), plan.briefs);
  await writeFile(join(root, 'project.json'), JSON.stringify(record, null, 2), { mode: 0o600, flag: 'wx' });
  return readProject(id, home);
}

/*
 Re-take the snapshot from the plan's source file — only while the project has
 never been started.

 Once `init` has run, the tasks live in state.json and editing the plan changes
 nothing (and must not appear to). Before that, the snapshot is just a copy
 waiting to be used, and refusing to update it would force a new project, a new
 id and a new Projects entry for a corrected typo or an improved brief.
*/
export async function refreshProject(id, home = PROJECT_HOME) {
  const project = await readProject(id, home);
  const started = await access(join(project.root, 'state.json')).then(() => true, e => {
    if (e.code === 'ENOENT') return false; throw e;
  });
  if (started) throw new Error('This project has already been started; its tasks now live in its run state. Import the new plan as a new project.');
  for (const lock of ['launch.lock', 'supervisor.lock', 'worker.lock']) {
    const lease = await inspectLease(join(project.root, lock));
    if (lease.held && !lease.dead) throw new Error('This project is being launched right now; refresh it once that has finished or failed.');
  }
  if (!project.sourcePath) throw new Error('This project records no source plan to refresh from');
  const markdown = /\.md$/i.test(project.sourcePath);
  if (markdown !== (project.planFile === 'plan.md')) throw new Error('The source plan changed format since it was imported');
  const plan = await loadAgentPlan(project.sourcePath);
  if (plan.tasks.flatMap(t => auditContractScope(t).findings).length) throw new Error('Plan contains protected or invalid write scopes');

  const planFile = join(project.root, project.planFile);
  const briefs = briefsDirectory(planFile);
  const stamp = `${process.pid}-${randomUUID()}`;
  const staged = `${briefs}.new-${stamp}`, retired = `${briefs}.old-${stamp}`;
  if (plan.briefs) await writeBriefSnapshot(staged, plan.briefs);
  await writeFile(`${planFile}.new-${stamp}`, plan.source, { mode: 0o600, flag: 'wx' });
  // Swap: the old briefs are moved aside, not deleted, until the new ones are in.
  const hadBriefs = await access(briefs).then(() => true, () => false);
  if (hadBriefs) await rename(briefs, retired);
  if (plan.briefs) await rename(staged, briefs);
  await rename(`${planFile}.new-${stamp}`, planFile);
  if (hadBriefs) await rm(retired, { recursive: true, force: true });

  const file = join(project.root, 'project.json');
  const record = JSON.parse(await readFile(file, 'utf8'));
  const temporary = `${file}.tmp-${stamp}`;
  await writeFile(temporary, JSON.stringify({ ...record, taskCount: plan.tasks.length, refreshedAt: new Date().toISOString() }, null, 2), { mode: 0o600, flag: 'wx' });
  await rename(temporary, file);
  return { project: await readProject(id, home), tasks: plan.tasks.length,
    briefs: plan.briefs ? Object.fromEntries(plan.tasks.map(task => [task.id, task.brief.length])) : null };
}
/*
 Improve the briefs of a project that is already running, without a new run.

 The briefs are what the local models work from; the first real run showed
 thin ones cost whole attempts. Re-initializing to deliver better ones would
 throw away accepted work, so this refreshes the briefs alone -- for tasks not
 yet done -- and refuses anything else: the plan's task blocks must be exactly
 the ones the run was started with, and no supervisor or worker may be live.
*/
export async function rebriefProject(id, { home = PROJECT_HOME, reason } = {}) {
  const { readProjectAgent, refreshRunBriefs } = await import('../orion-project-agent.mjs');
  const { contractDigest, normalizeTaskContract } = await import('./contract.mjs');
  const project = await readProject(id, home);
  for (const lock of ['launch.lock', 'supervisor.lock', 'worker.lock']) {
    const lease = await inspectLease(join(project.root, lock));
    if (lease.held && !lease.dead) throw new Error('This project is running; stop it before refreshing its briefs.');
  }
  const state = await readProjectAgent(project.root);
  if (!project.sourcePath) throw new Error('This project records no source plan to take briefs from');
  const plan = await loadAgentPlan(project.sourcePath);
  // Identity without the brief (and without `rev`, which a rebrief raises):
  // everything the human approved must be exactly what the run is executing.
  const bare = task => contractDigest(normalizeTaskContract({ ...task, brief: '', rev: 1 }));
  const planned = new Map(state.tasks.filter(task => task.origin === 'plan').map(task => [task.id, bare(task)]));
  const source = new Map(plan.tasks.map(task => [task.id, bare(task)]));
  const differs = [...new Set([...planned.keys(), ...source.keys()])].filter(key => planned.get(key) !== source.get(key));
  if (differs.length) {
    throw new Error(`The plan's task blocks differ from the running tasks (${differs.join(', ')}); only briefs can change on a started run.`);
  }
  const planFile = join(project.root, project.planFile);
  const briefs = briefsDirectory(planFile);
  const stamp = `${process.pid}-${randomUUID()}`;
  const staged = `${briefs}.new-${stamp}`, retired = `${briefs}.old-${stamp}`;
  if (plan.briefs) await writeBriefSnapshot(staged, plan.briefs);
  const hadBriefs = await access(briefs).then(() => true, () => false);
  if (hadBriefs) await rename(briefs, retired);
  if (plan.briefs) await rename(staged, briefs);
  if (hadBriefs) await rm(retired, { recursive: true, force: true });
  const wanted = Object.fromEntries(plan.tasks.map(task => [task.id, task.brief]));
  const next = await refreshRunBriefs(project.root, state.revision, { briefs: wanted, reason });
  const before = new Map(state.tasks.map(task => [task.id, task.brief ?? '']));
  return {
    project: project.id, revision: next.revision,
    changed: next.tasks.filter(task => before.get(task.id) !== (task.brief ?? ''))
      .map(task => ({ id: task.id, rev: task.rev, chars: (task.brief ?? '').length })),
    // Done or in flight: kept on the brief they were (or are being) judged against.
    untouched: next.tasks.filter(task => task.origin === 'plan' && Object.hasOwn(wanted, task.id) &&
      (task.brief ?? '') !== wanted[task.id]).map(task => ({ id: task.id, status: task.status })),
  };
}

export async function listProjects(home = PROJECT_HOME) {
  let entries;
  try { entries = await readdir(join(home, 'projects')); }
  catch (e) { if (e.code === 'ENOENT') return { projects: [], errors: [] }; throw e; }
  const projects = [], errors = [];
  for (const id of entries) {
    try { projects.push(await readProject(id, home)); }
    catch { errors.push(`Project ${id} could not be read`); }
  }
  projects.sort((a,b) => b.createdAt.localeCompare(a.createdAt));
  return { projects, errors };
}

// Continue may follow Exterminate or process death. Reconcile only while owning
// the supervisor lease; the recovery routine must independently prove the worker
// dead. Its unknown task stays blocked for normal escalation, never auto-accepted.
export async function prepareProjectContinuation(project, { launchRevision } = {}) {
  const { readProjectAgent, steerProjectAgent } = await import('../orion-project-agent.mjs');
  const { acquireLease, releaseLease } = await import('./lease.mjs');
  const { recoverRun } = await import('./supervisor.mjs');
  const { appendJournal } = await import('./journal.mjs');
  const lock = join(project.root, 'supervisor.lock');
  await acquireLease(lock, { extra: { role: 'project-continuation', projectID: project.id } });
  try {
    let state = await readProjectAgent(project.root);
    const initiallyHalted = state.stopRequested || state.pauseRequested || state.exterminateRequested || state.status === 'paused';
    if (initiallyHalted) {
      if (Number.isSafeInteger(launchRevision) && state.revision === launchRevision) {
        // It predates Start/Continue. Clear it while holding the supervisor
        // lease, before recovery. A halt arriving after this transaction gets
        // a newer revision and is observed again below.
        state = await steerProjectAgent(project.root, 'resume', state.revision);
      } else {
        return { state, shouldStart: false };
      }
    }
    if (state.status === 'interrupted' || state.activeTask) {
      const run = JSON.parse(await readFile(join(project.root, 'run.json'), 'utf8'));
      if (run.worktree !== join(project.root, 'worktree') || run.runId !== state.runId) throw new Error('Run metadata does not match this project');
      const events = [];
      await recoverRun(project.root, { worktree: run.worktree, emit: event => events.push(event) });
      for (const event of events) await appendJournal(project.root, { seq: null, runId: state.runId, actor: 'operator', ...event });
      state = await readProjectAgent(project.root);
    }
    const halted = state.stopRequested || state.pauseRequested || state.exterminateRequested || state.status === 'paused';
    if (halted) {
      return { state, shouldStart: false };
    }
    return { state, shouldStart: true };
  } finally { await releaseLease(lock); }
}
