import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { lintPlan } from '../scripts/lib/agentic/plan-lint.mjs';
import { normalizeTaskGraph } from '../scripts/lib/agentic/contract.mjs';
import { runCheck } from '../scripts/lib/agentic/checks.mjs';

/*
 docs/agentic/PLAN_STANDARD.md, as far as a machine can check it. Each rule is
 pinned to the shape that cost the first real batch time (2026-09-23..25).
*/
const task = (id, extra = {}) => ({
  id, title: `Task ${id}`, objective: `After this task, module ${id} exports run${id} and its tests pass.`,
  weight: 1, dependencies: [], scope: [`scripts/lib/${id}.mjs`, `tests/${id}.test.mjs`],
  checks: ['node-syntax', 'scope-tests'], acceptance: [`Export run${id}(input) returning { ok }.`],
  brief: `run${id}(input) -> { ok: boolean }`, ...extra,
});
const codes = (tasks, options = { briefs: { common: 'goal', byTask: {} } }) =>
  lintPlan({ tasks: normalizeTaskGraph(tasks) }, options).map(item => `${item.code}:${item.taskId ?? '-'}`);

test('a plan in the standard shape has nothing to say', () => {
  assert.deepEqual(codes([task('aa'), task('bb', { dependencies: ['aa'] }), task('cc'), task('dd', { dependencies: ['cc'] })]), []);
});

test('the first batch\'s shapes are all named', () => {
  const shared = ['scripts/lib/install.mjs', 'tests/install.test.mjs'];
  const suite = ['node-syntax', 'automation-tests'];
  const context = 'Read scripts/lib/a.mjs, b.mjs and c.mjs. This continues Phase 57; do not rebuild completed guards.';
  const tasks = ['aa', 'bb', 'cc', 'dd'].map((id, index, all) => task(id, {
    title: `Do ${id}`, objective: `Do ${id}`, scope: shared, checks: suite, context: `${context} Step ${id}.`,
    dependencies: index ? [all[index - 1]] : [],
    acceptance: ['Tests show success, concurrency refusal, unchanged record, failure before create, and failed read-back.',
      'Export install(options). Persist intent first. Then create. Then read back. Never enable.'],
    brief: 'nothing about the interface',
  }));
  const found = codes(tasks);
  for (const expected of ['linear-chain:-', 'shared-file:-', 'context-copied:-', 'no-own-check:aa',
    'objective-is-title:aa', 'bundled-scenarios:aa', 'compound-criterion:aa', 'interface-unspecified:aa']) {
    assert.ok(found.includes(expected), `${expected} in ${found.join(' ')}`);
  }
});

test('scope-tests with no test file in scope is an error; briefs are asked for', () => {
  const found = lintPlan({ tasks: normalizeTaskGraph([task('aa', { scope: ['scripts/lib/aa.mjs'], brief: undefined })]) }, { briefs: null });
  assert.ok(found.some(item => item.code === 'scope-tests-without-file' && item.level === 'error'));
  assert.ok(found.some(item => item.code === 'no-brief'));
  assert.ok(found.some(item => item.code === 'no-briefs'));
});

test('scope-tests runs only the task\'s own test files, and fails honestly when there are none', async t => {
  const worktree = await mkdtemp(join(tmpdir(), 'orion-scope-tests-'));
  t.after(() => rm(worktree, { recursive: true, force: true }));
  await mkdir(join(worktree, 'tests'), { recursive: true });
  await writeFile(join(worktree, 'tests/mine.test.mjs'), "import test from 'node:test'; test('mine', () => {});\n");
  await writeFile(join(worktree, 'tests/other.test.mjs'), "import test from 'node:test'; test('other', () => { throw new Error('not mine'); });\n");
  const passing = await runCheck('scope-tests', { worktree, scope: ['tests/mine.test.mjs', 'scripts/lib/x.mjs'] });
  assert.equal(passing.ok, true, passing.output);
  const unwritten = await runCheck('scope-tests', { worktree, scope: ['tests/later.test.mjs'] });
  assert.equal(unwritten.ok, false);
  assert.match(unwritten.output, /none of this task's test files exist yet/);
  const none = await runCheck('scope-tests', { worktree, scope: ['scripts/lib/x.mjs', 'tests/../escape.test.mjs'] });
  assert.equal(none.ok, false);
  assert.match(none.output, /no tests\/\*\.test\.mjs file in its scope/);
});
