/*
 What is already there, before a task writes anything.

 Nick (2026-09-25), before handing the loop Astra's whole plan: some of it will
 already be done, or half done. "at the start of every task double check whats
 already there for this ... if theres already work done or if its already
 completed then it should account for that and not overwrite unless its
 improvements."

 Three pieces, all deterministic — the model is told, and then held to it:

   surveyExistingWork   at the start of every attempt: which scope files exist,
                        what they export, how many tests they hold, when they
                        last changed, and whether the names the contract
                        promises are already defined somewhere in the repo.
                        Shown to the worker on every exchange.
   overwriteRisk        before every write: a write that would delete existing
                        exports or tests the contract does not mention, or
                        replace most of a substantial file wholesale, is refused
                        with the reason. Improvements go in as edits.
   (already satisfied)  a task whose work already exists can be finished without
                        writing: the worker says so, the host records an empty
                        checkpoint, and the reviewer judges the existing files
                        against every criterion (see worker.mjs / reviewer.mjs).
*/
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);
const GIT = '/usr/bin/git';

const EXPORT_DECLARATION = /^export\s+(?:default\s+)?(?:async\s+)?(?:function\*?|const|class|let|var)\s+([A-Za-z_$][\w$]*)/gm;
const EXPORT_LIST = /^export\s*\{([^}]*)\}/gm;
const TEST_CASE = /^\s*(?:test|it)(?:\.\w+)?\s*\(/gm;

/** Names a module exports, in either spelling. */
export function exportedNames(source) {
  const names = new Set([...String(source).matchAll(EXPORT_DECLARATION)].map(match => match[1]));
  for (const match of String(source).matchAll(EXPORT_LIST)) {
    for (const entry of match[1].split(',')) {
      const name = entry.trim().split(/\s+as\s+/).pop()?.trim();
      if (name && /^[A-Za-z_$][\w$]*$/.test(name) && name !== 'default') names.add(name);
    }
  }
  return names;
}

export function testCount(source) {
  return (String(source).match(TEST_CASE) ?? []).length;
}

/** Function names the contract promises: `Export foo(...)`, `exports foo(`. */
export function promisedNames(task) {
  const text = [task.objective, ...(task.acceptance ?? [])].join('\n');
  return [...new Set([...text.matchAll(/\bexports?\s+`?([A-Za-z_$][\w$]*)\s*\(/gi)].map(match => match[1]))];
}

async function git(worktree, args) {
  try { return (await run(GIT, args, { cwd: worktree, maxBuffer: 4 * 1024 * 1024 })).stdout.trim(); }
  catch { return ''; }
}

export async function surveyExistingWork(worktree, task) {
  const files = [];
  for (const path of task.scope) {
    if (path.endsWith('/')) continue;
    let source = null;
    try { source = await readFile(join(worktree, path), 'utf8'); } catch { /* not there yet */ }
    if (source === null) { files.push({ path, exists: false }); continue; }
    const last = await git(worktree, ['log', '-1', '--format=%h%x09%cs%x09%s', '--', path]);
    const [sha, date, subject] = last ? last.split('\t') : [];
    files.push({
      path, exists: true, bytes: Buffer.byteLength(source), lines: source.split('\n').length,
      exports: [...exportedNames(source)].slice(0, 40),
      tests: /\.test\.m?[jt]s$/.test(path) ? testCount(source) : null,
      lastCommit: sha ? { sha, date, subject: String(subject ?? '').slice(0, 120) } : null,
    });
  }
  const promised = [];
  for (const name of promisedNames(task)) {
    const found = await git(worktree, ['grep', '-l', '-E',
      // POSIX classes: git grep's ERE has no \s or \b.
      `(function\\*?|const|class|let|var)[[:space:]]+${name}([^A-Za-z0-9_$]|$)`, '--', '*.mjs', '*.js', '*.ts']);
    promised.push({ name, definedIn: found ? found.split('\n').slice(0, 5) : [] });
  }
  return { files, promised };
}

/** The survey as the worker and reviewer read it. */
export function renderSurvey(survey) {
  if (!survey) return '';
  const lines = survey.files.map(file => file.exists
    ? `- ${file.path} — EXISTS: ${file.lines} lines` +
      `${file.exports?.length ? `, exports ${file.exports.join(', ')}` : ''}` +
      `${file.tests !== null ? `, ${file.tests} test case(s)` : ''}` +
      `${file.lastCommit ? `; last changed ${file.lastCommit.date} (${file.lastCommit.sha} ${file.lastCommit.subject})` : ''}`
    : `- ${file.path} — does not exist yet`);
  const promised = survey.promised.map(item => item.definedIn.length
    ? `- ${item.name}: ALREADY DEFINED in ${item.definedIn.join(', ')}`
    : `- ${item.name}: not defined anywhere yet`);
  const anything = survey.files.some(file => file.exists) || survey.promised.some(item => item.definedIn.length);
  return [
    '## ALREADY IN THE REPOSITORY — read this before you write',
    ...lines,
    ...(promised.length ? ['', 'What this contract promises:', ...promised] : []),
    '',
    anything
      ? 'Some of this task may already be done. READ the existing files first. Keep what works; change it with ' +
        '### EDIT; never delete existing exports or tests the contract does not ask you to remove. If the existing ' +
        'code already meets every acceptance criterion, run ### CHECK and finish with `### DONE` starting ' +
        '"ALREADY SATISFIED:" and say where each criterion is met.'
      : 'Nothing for this task exists yet; you are starting from scratch.',
  ].join('\n');
}

/**
 * Why writing `after` over `before` would destroy existing work, or null.
 * `contractText` whitelists names the contract itself mentions: a task asked to
 * rename or remove something may.
 */
export function overwriteRisk(path, before, after, { contractText = '', wholeFile = true } = {}) {
  if (!before) return null;
  const mentioned = name => new RegExp(`\\b${name.replace(/\$/g, '\\$')}\\b`).test(contractText);
  const lost = [...exportedNames(before)].filter(name => !exportedNames(after).has(name) && !mentioned(name));
  if (lost.length) {
    return `it would remove existing export(s) ${lost.join(', ')} from ${path}, which this contract does not ask for. ` +
      'Keep them; change behaviour with ### EDIT.';
  }
  const beforeTests = testCount(before), afterTests = testCount(after);
  if (afterTests < beforeTests) {
    return `it would reduce ${path} from ${beforeTests} to ${afterTests} test case(s). Existing tests stay; add yours beside them.`;
  }
  const beforeLines = before.split('\n').length, afterLines = after.split('\n').length;
  if (wholeFile && beforeLines >= 40 && afterLines < beforeLines * 0.5) {
    return `it would replace ${path} (${beforeLines} lines) with ${afterLines} lines, discarding most of the existing file. ` +
      'Change the parts that need it with ### EDIT.';
  }
  return null;
}
