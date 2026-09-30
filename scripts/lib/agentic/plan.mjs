// Markdown is the human backlog; explicitly marked contracts are its runnable
// subset. Never ask a model to infer write authority from arbitrary prose.
import { readdir, readFile, stat } from 'node:fs/promises';
import { basename, dirname, extname, join } from 'node:path';
import { MAX_BRIEF, ID_PATTERN, normalizeTaskGraph } from './contract.mjs';
import { isRegisteredCheck } from './checks.mjs';

/*
 BRIEFS — reference material that travels with the contract.

 A plan's prose never reaches the model; only its task blocks do, and a task's
 `context` is one short paragraph. For a worker that works alone for hours that
 is too little: it spends attempts rediscovering signatures and record formats,
 or guesses them. So a plan may carry briefs, in a folder beside it named after
 it — `my-plan.md` has `my-plan.briefs/` —

   common.md       for every task
   <task-id>.md    for that task only

 and each task's contract gets `brief` = common + its own. The plan file itself
 is untouched, which is the point: the approved plan stays exactly what was
 approved, and the briefs can be written, fact-checked and improved beside it.

 They are loaded HERE, on the host, rather than read by the worker from the
 repository, because the worker's worktree is built from the last commit and an
 uncommitted brief would simply not be there.

 Strict on purpose. A file that names no task is a typo that would otherwise
 leave a task briefless without anyone noticing; so is a brief too long to fit,
 and so is a task that carries its own inline brief as well.
*/
export function briefsDirectory(planPath) {
  return join(dirname(planPath), `${basename(planPath, extname(planPath))}.briefs`);
}

export async function readPlanBriefs(planPath) {
  const directory = briefsDirectory(planPath);
  try {
    if (!(await stat(directory)).isDirectory()) throw new Error(`${directory} is not a directory`);
  } catch (error) {
    if (error.code === 'ENOENT') return null;
    throw error;
  }
  const briefs = { directory, common: '', byTask: {} };
  for (const name of (await readdir(directory)).sort()) {
    if (name.startsWith('.')) continue;
    if (!name.endsWith('.md')) throw new Error(`Unexpected file in ${directory}: ${name} (only common.md and <task-id>.md belong here)`);
    const id = name.slice(0, -3);
    if (id !== 'common' && !ID_PATTERN.test(id)) throw new Error(`Brief ${name} is not named after a task id`);
    const text = (await readFile(join(directory, name), 'utf8')).replace(/\r\n/g, '\n').trim();
    if (!text) throw new Error(`Brief ${name} is empty`);
    if (id === 'common') briefs.common = text;
    else briefs.byTask[id] = text;
  }
  return briefs;
}

function attachBriefs(rawTasks, briefs) {
  // Malformed input is left for normalizeTaskGraph, which names the problem.
  if (!briefs || !Array.isArray(rawTasks)) return rawTasks;
  const ids = new Set(rawTasks.map(task => task?.id));
  const orphan = Object.keys(briefs.byTask).find(id => !ids.has(id));
  if (orphan) throw new Error(`Brief ${orphan}.md names no task in this plan`);
  return rawTasks.map(task => {
    if (!task || typeof task !== 'object' || Array.isArray(task)) return task;
    const own = briefs.byTask[task.id] ?? '';
    const brief = [briefs.common, own].filter(Boolean).join('\n\n---\n\n');
    if (!brief) return task;
    if (task.brief !== undefined) throw new Error(`Task ${task.id} has an inline brief and a brief file; keep one`);
    if (brief.length > MAX_BRIEF) {
      throw new Error(`The brief for ${task.id} is ${brief.length} characters (common.md + ${task.id}.md); the limit is ${MAX_BRIEF}`);
    }
    return { ...task, brief };
  });
}

/** Read a plan file and the briefs beside it. The one way the CLIs load a plan. */
export async function loadAgentPlan(planPath) {
  const source = await readFile(planPath, 'utf8');
  const briefs = await readPlanBriefs(planPath);
  const plan = parseAgentPlan(source, { markdown: /\.md$/i.test(planPath), briefs });
  return { ...plan, source, briefs };
}

export function parseAgentPlan(source, { markdown = false, briefs = null } = {}) {
  let plan;
  if (!markdown) plan = JSON.parse(source);
  else {
    let metadata = null;
    const tasks = [];
    const lines = source.replace(/\r\n/g, '\n').split('\n');
    for (let i = 0; i < lines.length; i++) {
      const opening = lines[i].match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
      if (!opening) continue;
      const [, fence, info] = opening;
      const language = info.trim();
      const closing = new RegExp(`^ {0,3}${fence[0]}{${fence.length},}\\s*$`);
      const body = [];
      while (++i < lines.length && !closing.test(lines[i])) body.push(lines[i]);
      if (!['orion-plan', 'orion-task'].includes(language)) continue;
      if (i === lines.length) throw new Error(`Unclosed ${language} block`);
      let value;
      try { value = JSON.parse(body.join('\n')); }
      catch { throw new Error(`Invalid JSON in ${language} block`); }
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${language} must contain an object`);
      if (language === 'orion-plan') {
        if (metadata) throw new Error('Markdown must contain exactly one orion-plan block');
        if (Object.keys(value).some(k => !['project', 'options'].includes(k))) throw new Error('orion-plan only accepts project and options');
        metadata = value;
      } else tasks.push(value);
    }
    if (!metadata || !tasks.length) throw new Error('Markdown needs one orion-plan block and at least one orion-task block');
    plan = { ...metadata, tasks };
  }
  const tasks = normalizeTaskGraph(attachBriefs(plan.tasks ?? plan, briefs));
  const unknown = [...new Set(tasks.flatMap(t => t.checks))].filter(n => !isRegisteredCheck(n));
  if (unknown.length) throw new Error(`plan names unregistered check(s): ${unknown.join(', ')}`);
  const options = plan.options ?? {};
  if (!options || typeof options !== 'object' || Array.isArray(options) ||
      Object.keys(options).some(k => !['maxAttempts', 'maxCorrectionDepth'].includes(k))) throw new Error('Invalid plan options');
  if (options.maxAttempts !== undefined && (!Number.isInteger(options.maxAttempts) || options.maxAttempts < 1 || options.maxAttempts > 10)) throw new Error('Invalid maxAttempts');
  if (options.maxCorrectionDepth !== undefined && (!Number.isInteger(options.maxCorrectionDepth) || options.maxCorrectionDepth < 0 || options.maxCorrectionDepth > 3)) throw new Error('Invalid maxCorrectionDepth');
  return { project: typeof plan.project === 'string' ? plan.project : 'ORION', tasks, options };
}
