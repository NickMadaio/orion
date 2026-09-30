/*
 Plan lint: the parts of docs/agentic/PLAN_STANDARD.md a machine can check.

 The loader (plan.mjs, contract.mjs) refuses plans that CANNOT run: bad JSON, a
 cycle, an unregistered check, a protected scope. This finds plans that will run
 BADLY — the shapes that cost the first real batch (2026-09-23..25) its nights:

   every task writing the same two growing files, so each write got slower and
   each task inherited the last one's bulk;
   a strict chain, so one hard task stopped everything behind it;
   the same three suite checks on every task, so no check was about the task;
   one acceptance criterion holding six test scenarios, so the reviewer blocked
   the whole task on it twice.

 Findings are advice with a code, never a refusal: an approved plan still loads.
 `error` is reserved for a contract that cannot pass as written.
*/

const CODE_FILE = /\.(mjs|cjs|js|ts|tsx|swift|py)$/;
const TEST_FILE = /^tests\/.+\.test\.mjs$/;
const normalize = text => String(text ?? '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const finding = (level, code, taskId, message) => ({ level, code, taskId, message });

/** Every task on one path: n tasks and a longest dependency chain of n. */
function longestChain(tasks) {
  const byId = new Map(tasks.map(task => [task.id, task]));
  const memo = new Map();
  const depth = id => {
    if (memo.has(id)) return memo.get(id);
    const value = 1 + Math.max(0, ...byId.get(id).dependencies.filter(dep => byId.has(dep)).map(depth));
    memo.set(id, value);
    return value;
  };
  return Math.max(...tasks.map(task => depth(task.id)));
}

/** Names an acceptance criterion promises to export: `Export foo(...)` or `export foo`. */
function promisedExports(criterion) {
  return [...String(criterion).matchAll(/\bexports?\s+`?([A-Za-z_$][\w$]*)\s*\(/gi)].map(match => match[1]);
}

export function lintPlan(plan, { briefs = null } = {}) {
  const tasks = plan.tasks;
  const out = [];

  // ---- Architecture: how the tasks fit together ----
  if (tasks.length >= 4 && longestChain(tasks) === tasks.length) {
    out.push(finding('warn', 'linear-chain', null,
      `All ${tasks.length} tasks form one chain, so a single deferred task stops everything after it. ` +
      'Declare only the dependencies the code needs, and give the graph independent branches.'));
  }
  const writers = new Map();
  for (const task of tasks) for (const path of task.scope) {
    if (path.endsWith('/')) continue;
    writers.set(path, [...(writers.get(path) ?? []), task.id]);
  }
  for (const [path, ids] of writers) {
    if (ids.length >= 3) {
      out.push(finding('warn', 'shared-file', null,
        `${path} is written by ${ids.length} tasks (${ids.join(', ')}). It grows with each one, and every later ` +
        'write retypes it. Give each task its own module or test file; share through imports.'));
    }
  }
  const signature = task => [...task.checks].sort().join(',');
  for (const task of tasks) {
    const same = tasks.filter(other => signature(other) === signature(task)).length;
    const code = task.scope.some(path => CODE_FILE.test(path));
    if (code && same >= 3 && !task.checks.includes('scope-tests')) {
      out.push(finding('warn', 'no-own-check', task.id,
        `Its checks (${task.checks.join(', ')}) are the same as ${same - 1} other tasks'. Add scope-tests ` +
        'with a test file of its own in scope, so a check is about THIS task.'));
    }
    if (task.checks.includes('scope-tests') && !task.scope.some(path => TEST_FILE.test(path))) {
      out.push(finding('error', 'scope-tests-without-file', task.id,
        'Names scope-tests but has no tests/*.test.mjs file in its scope; that check can never pass.'));
    }
    const docsOnly = task.scope.every(path => /\.md$/.test(path));
    if (docsOnly && task.checks.every(name => name !== 'no-orphan-exports')) {
      out.push(finding('info', 'docs-task', task.id,
        'A documentation task: no registered check reads the document, so the reviewer is its only gate. ' +
        'Make each acceptance criterion name a section or fact the reviewer can find.'));
    }
  }

  // ---- Information: what each contract tells the model ----
  const contexts = new Map();
  // Keyed on the opening: copies usually differ only in a closing sentence.
  for (const task of tasks) if (task.context) {
    const key = normalize(task.context).slice(0, 80);
    contexts.set(key, [...(contexts.get(key) ?? []), task.id]);
  }
  for (const [, ids] of contexts) {
    if (ids.length >= 3) {
      out.push(finding('warn', 'context-copied', null,
        `${ids.length} tasks share one context paragraph (${ids.join(', ')}). Put the shared part in common.md ` +
        'and make each context say what THIS task needs to read and why.'));
    }
  }
  for (const task of tasks) {
    const objective = normalize(task.objective), title = normalize(task.title);
    if (objective === title || (objective.length < 100 && objective.includes(title))) {
      out.push(finding('warn', 'objective-is-title', task.id,
        'The objective restates the title. Say what exists and is true when the task is done.'));
    }
    if (task.acceptance.length > 8) {
      out.push(finding('warn', 'too-many-criteria', task.id,
        `${task.acceptance.length} acceptance criteria; more than 8 usually means two tasks.`));
    }
    task.acceptance.forEach((criterion, index) => {
      const sentences = criterion.split(/(?<=[.;])\s+/).filter(Boolean).length;
      if (criterion.length > 320 || sentences >= 3) {
        out.push(finding('warn', 'compound-criterion', task.id,
          `Criterion ${index + 1} holds ${sentences} statements in ${criterion.length} characters. One verifiable ` +
          'statement per criterion: a reviewer that finds one part missing fails all of it.'));
      }
      if (/\btests?\b[^.]*\b(show|include|cover|exercise)/i.test(criterion) && (criterion.match(/,/g) ?? []).length >= 3) {
        out.push(finding('warn', 'bundled-scenarios', task.id,
          `Criterion ${index + 1} lists several test scenarios in one line. Give each scenario its own criterion, ` +
          'or name the exact test titles in the brief.'));
      }
    });
    const brief = task.brief ?? '';
    if (!brief) {
      out.push(finding('warn', 'no-brief', task.id,
        'No brief: the worker has only the contract, and will spend attempts rediscovering signatures and formats.'));
    } else {
      const missing = [...new Set(task.acceptance.flatMap(promisedExports))].filter(name => !brief.includes(name));
      if (missing.length) {
        out.push(finding('warn', 'interface-unspecified', task.id,
          `Promises ${missing.join(', ')} but its brief never names it. Give the exact signature, inputs and return shape.`));
      }
    }
  }
  if (briefs && !briefs.common) {
    out.push(finding('warn', 'no-common-brief', null,
      "No common.md. The plan's prose never reaches the model: the product goal, house rules and shared formats must be in common.md."));
  } else if (!briefs) {
    out.push(finding('warn', 'no-briefs', null,
      "No briefs folder. The plan's prose never reaches the model; put the goal and shared reference in <plan>.briefs/common.md."));
  }
  return out;
}

export function lintSummary(findings) {
  const count = level => findings.filter(item => item.level === level).length;
  return { errors: count('error'), warnings: count('warn'), notes: count('info') };
}
