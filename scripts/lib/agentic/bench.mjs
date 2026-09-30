/*
 Model benchmarking.

 THE QUESTION THIS ANSWERS

 Not "which model is fastest". The mission states the real one:

   Which configuration produces the most Astra-acceptable ORION development
   per real elapsed hour?

 So the headline metric is `acceptedWeightPerHour`, and tokens-per-second is not
 recorded at all. A model that is twice as fast and needs three correction cycles
 has lost. `reviewerRepairs` is tracked separately and weighted heavily in
 judgement, because a repair means the WORKER failed and the reviewer had to stop
 reviewing and write code — the most expensive local outcome short of waking Nick.

 EVERY CANDIDATE RUNS THE SAME TASKS IN A DISPOSABLE REPOSITORY

 Not against ORION. A benchmark that mutates the thing being developed cannot be
 repeated, and the second candidate would start from the first one's output. Each
 run gets a fresh git repository built from the fixture below, so the only
 variable is the model configuration.

 The fixture tasks are deliberately ORION-SHAPED rather than toy puzzles: read an
 existing module, respect a stated non-scope, satisfy a criterion that the check
 alone does not prove. Those are what the local loop will actually be asked to
 do, and they are where the 27B/80B difference should show up.
*/
import { execFile } from 'node:child_process';
import { appendFile, copyFile, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { initializeProjectAgent, projectAgentProgress } from '../orion-project-agent.mjs';
import { readJournal } from './journal.mjs';
import { ModelRuntime } from './models.mjs';
import { superviseRun } from './supervisor.mjs';

const run = promisify(execFile);
const GIT_ENV = {
  PATH: '/usr/bin:/bin', HOME: process.env.HOME ?? '', GIT_CONFIG_NOSYSTEM: '1',
  GIT_AUTHOR_NAME: 'Bench', GIT_AUTHOR_EMAIL: 'bench@localhost',
  GIT_COMMITTER_NAME: 'Bench', GIT_COMMITTER_EMAIL: 'bench@localhost',
};

/** The files a benchmark run starts from. Small, but not trivial to read. */
const FIXTURE = {
  'sandbox/store.mjs': `// A tiny in-memory record store. Deliberately has a gap the tasks must close.
const records = new Map();

export function put(id, value) {
  records.set(id, { ...value, id });
  return records.get(id);
}

export function get(id) {
  return records.get(id) ?? null;
}

export function all() {
  return [...records.values()];
}
`,
  'sandbox/store.test.mjs': `import test from 'node:test';
import assert from 'node:assert/strict';
import { put, get, all } from './store.mjs';

test('put and get round-trip', () => {
  put('a', { name: 'first' });
  assert.equal(get('a').name, 'first');
  assert.equal(get('missing'), null);
  assert.equal(all().length, 1);
});
`,
};

/** The benchmark task set. Same contracts for every candidate. */
export const BENCH_TASKS = Object.freeze([
  {
    id: 'bench-remove',
    title: 'Add a remove function to the store',
    objective: 'sandbox/store.mjs exports remove(id) which deletes a record and returns true, or returns false when the id was not present.',
    context: 'The store already has put, get and all. Follow the shape of what is there.',
    weight: 2, dependencies: [], scope: ['sandbox/store.mjs'],
    nonScope: ['Do not change put, get or all', 'Do not change sandbox/store.test.mjs'],
    constraints: ['Plain ES modules, no new imports', 'Keep the existing immutable spread in put'],
    acceptance: [
      'remove is exported from sandbox/store.mjs',
      'remove returns true when the record existed and false when it did not',
      'put, get and all still behave exactly as before',
    ],
    checks: ['node-syntax'], risk: 'low', reviewDepth: 'standard',
  },
  {
    id: 'bench-cover',
    title: 'Cover remove with a test',
    objective: 'sandbox/store.test.mjs gains a test proving remove returns true for a present id, false for an absent one, and that the record is gone afterwards.',
    context: 'Read the existing test file first and match its style. Import remove from the module; do not reimplement it.',
    weight: 2, dependencies: ['bench-remove'], scope: ['sandbox/store.test.mjs'],
    nonScope: ['Do not modify sandbox/store.mjs', 'Do not weaken or delete the existing round-trip test'],
    constraints: ['Use node:test and node:assert/strict, as the file already does'],
    acceptance: [
      'the existing round-trip test is unchanged',
      'a new test asserts both the true and the false return of remove',
      'a new test asserts get(id) is null after remove',
    ],
    checks: ['node-syntax'], risk: 'low', reviewDepth: 'standard',
  },
]);

async function disposableRepository() {
  const base = await mkdtemp(join(tmpdir(), 'orion-bench-'));
  const worktree = join(base, 'repo');
  for (const [path, contents] of Object.entries(FIXTURE)) {
    await mkdir(join(worktree, path, '..'), { recursive: true });
    await writeFile(join(worktree, path), contents);
  }
  await run('/usr/bin/git', ['init', '-q', '-b', 'main'], { cwd: worktree, env: GIT_ENV });
  await run('/usr/bin/git', ['add', '.'], { cwd: worktree, env: GIT_ENV });
  await run('/usr/bin/git', ['commit', '-qm', 'bench fixture'], { cwd: worktree, env: GIT_ENV });
  const { stdout } = await run('/usr/bin/git', ['rev-parse', 'HEAD'], { cwd: worktree, env: GIT_ENV });
  return { base, worktree, baseRef: stdout.trim(), root: join(base, 'state') };
}

function summarize(journal) {
  const byKind = kind => journal.filter(entry => entry.kind === kind);
  const msFor = kind => byKind(kind).reduce((sum, entry) => sum + (entry.ms ?? 0), 0);
  const sumOf = field => journal.reduce((sum, entry) => sum + (entry[field] ?? 0), 0);
  const meanOf = (kind, field) => {
    const values = byKind(kind).map(entry => entry[field]).filter(Number.isFinite);
    return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
  };
  const checkRuns = byKind('checks_run');
  const firstPass = checkRuns.length
    ? checkRuns.filter((entry, index) => index === 0 && (entry.results ?? []).every(result => result.ok)).length
    : 0;
  return {
    workerTurns: byKind('worker_turn').length,
    workerMs: msFor('worker_turn'),
    reviewerPasses: byKind('reviewer_turn').length,
    reviewerMs: msFor('reviewer_turn') + msFor('repair_turn') + msFor('final_review_turn'),
    unusableReplies: byKind('worker_unusable_reply').length,
    rejectedReviews: byKind('reviewer_rejected').length,
    writesRefused: byKind('worker_write_refused').length,
    checkRuns: checkRuns.length,
    firstAttemptCheckPass: firstPass,
    contractChangeProposals: byKind('contract_change_proposed').length,
    // Diagnostic, not the headline. It explains a slow candidate; it does not
    // decide between candidates -- `acceptedWeightPerHour` does that.
    outputTokens: sumOf('outputTokens'),
    workerTokensPerMinute: meanOf('worker_turn', 'outputTokensPerMinute'),
    reviewerTokensPerMinute: meanOf('reviewer_turn', 'outputTokensPerMinute'),
  };
}

/**
 * Run the benchmark once for one configuration. Returns a flat record suitable
 * for a ledger line and for a table.
 */
export async function benchmarkCandidate({ name, config, durationMs = 2 * 3600_000, tasks = BENCH_TASKS,
  keepJournalIn = null, onProgress = () => {} }) {
  const { base, worktree, baseRef, root } = await disposableRepository();
  const started = Date.now();
  let result, failure = null;
  try {
    await initializeProjectAgent(root, tasks, {
      maxAttempts: config.limits.maxAttempts, maxCorrectionDepth: config.limits.maxCorrectionDepth,
    });
    onProgress({ candidate: name, phase: 'running' });
    result = await superviseRun(root, {
      worktree, baseRef, runtime: new ModelRuntime(config), config, project: `bench:${name}`,
      durationMs,
      // A benchmark must never page Nick. It also must never be the reason an
      // escalation goes unnoticed, so the escalation still lands in state.
      notifyRecovery: async () => ({ delivered: false }),
      notify: async () => ({ attempted: false, delivered: false, reason: 'benchmark', briefPath: null, message: null }),
    });
  } catch (error) {
    failure = String(error?.message ?? error);
  }
  const wallClockMs = Date.now() - started;
  const journal = result ? await readJournal(root, { limit: Number.MAX_SAFE_INTEGER }) : [];
  const state = result?.state ?? null;
  const progress = state ? projectAgentProgress(state) : null;
  const acceptedWeight = state
    ? state.tasks.filter(task => task.status === 'accepted').reduce((sum, task) => sum + task.weight, 0)
    : 0;

  const record = {
    at: new Date().toISOString(),
    candidate: name,
    models: Object.fromEntries(Object.entries(config.roles).map(([role, spec]) => [role, spec.model])),
    limits: config.limits,
    failure,
    completed: state?.status === 'completed',
    escalations: (state?.escalations ?? []).filter(e => !e.resolvedAt)
      .map(e => ({ kind: e.kind, taskId: e.taskId, reason: e.reason.slice(0, 200) })),
    tasksPlanned: tasks.length,
    tasksAccepted: progress?.acceptedTasks ?? 0,
    tasksBlocked: progress?.blockedTasks ?? 0,
    correctionTasks: progress?.correctionTasks ?? 0,
    reviewerRepairs: state?.repairs.length ?? 0,
    reviewDecisions: (state?.reviews ?? []).map(review => review.decision),
    wallClockMs,
    // The headline. Accepted WEIGHT, not task count: a plan's weights are how it
    // says which work mattered, and counting tasks would reward a model that
    // only finished the easy ones.
    acceptedWeightPerHour: Number(((acceptedWeight / (wallClockMs / 3600_000)) || 0).toFixed(2)),
    ...summarize(journal),
  };
  // Keep the journal before the disposable repository goes. The summary says a
  // task blocked; only the journal says WHY, and a benchmark that throws away
  // the evidence cannot answer the question it exists to answer. The first real
  // run of this harness blocked a task and the explanation had already been
  // deleted.
  if (keepJournalIn) {
    const kept = join(keepJournalIn, `${name.replace(/[^a-z0-9.:-]/gi, '_')}-${record.at.replace(/[:.]/g, '-')}.jsonl`);
    await mkdir(keepJournalIn, { recursive: true, mode: 0o700 });
    await copyFile(join(root, 'journal.jsonl'), kept).then(() => { record.journal = kept; }).catch(() => {});
  }
  await rm(base, { recursive: true, force: true });
  onProgress({ candidate: name, phase: 'done', record });
  return record;
}

/** Append one result to the durable ledger, so results accumulate across sessions. */
export async function recordBenchmark(ledgerPath, record) {
  await mkdir(join(ledgerPath, '..'), { recursive: true, mode: 0o700 });
  await appendFile(ledgerPath, `${JSON.stringify(record)}\n`, { mode: 0o600 });
}

/** A table a person can read without jq. */
export function formatBenchmark(records) {
  const header = ['candidate', 'worker', 'reviewer', 'accepted', 'blocked', 'corr', 'repairs', 'wall', 'wt/hr'];
  const rows = records.map(record => [
    record.candidate,
    record.models.worker ?? '?',
    record.models.reviewer ?? '?',
    `${record.tasksAccepted}/${record.tasksPlanned}`,
    String(record.tasksBlocked),
    String(record.correctionTasks),
    String(record.reviewerRepairs),
    `${Math.round(record.wallClockMs / 60000)}m`,
    String(record.acceptedWeightPerHour),
    [record.workerTokensPerMinute, record.reviewerTokensPerMinute].filter(Boolean).join('/') || '—',
  ]);
  const widths = header.map((_, index) => Math.max(header[index].length, ...rows.map(row => row[index].length)));
  const line = cells => cells.map((cell, index) => cell.padEnd(widths[index])).join('  ');
  return [line(header), line(widths.map(width => '-'.repeat(width))), ...rows.map(line)].join('\n');
}
