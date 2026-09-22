/*
 Worker (base coding) eval — measures UNDERSTANDING, not token speed.

 The task is built so the obvious implementation is subtly wrong in three ways a
 fast pattern-matcher gets caught by, and a model that actually read the file
 does not:

   1. IMMUTABILITY   the existing `put` spreads into a new object. A naive
                     `update` mutates the stored record in place. The contract
                     states the constraint explicitly; obeying it requires
                     having read `put` rather than guessing from the name.
   2. MISSING ID     must return null. Naive versions return undefined, throw,
                     or create the record.
   3. NO COLLATERAL  `put`, `get`, `all` must be untouched. A model that
                     "tidies while it is in there" fails.

 Scored on the model's ACTUAL OUTPUT run against a hidden test — not on whether
 the prose sounded right.

 Uses the real worker system prompt and the real marker parser, so protocol
 compliance is measured on the production path.
*/
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { normalizeTaskContract } from '../contract.mjs';
import { parseWorkerReply, systemPrompt, workerTurn } from '../prompts.mjs';
import { ModelRuntime, DEFAULT_CONFIG } from '../models.mjs';

const run = promisify(execFile);

const STORE = `// A tiny in-memory record store.
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
`;

const contract = normalizeTaskContract({
  id: 'store-update',
  title: 'Add update(id, patch) to the record store',
  objective: 'sandbox/store.mjs exports update(id, patch) which merges patch into an existing record and returns the updated record, or returns null when no record has that id.',
  context: 'The store already has put, get and all. Read them before writing anything.',
  weight: 2,
  dependencies: [],
  scope: ['sandbox/store.mjs'],
  nonScope: ['Do not change put, get or all', 'Do not add new files'],
  constraints: [
    'Never mutate a stored record in place — create a new object, exactly as put does',
    'The record id must not be changeable by a patch',
    'Plain ES modules, no new imports',
  ],
  acceptance: [
    'update is exported from sandbox/store.mjs',
    'update("a", {name: "x"}) returns the merged record when "a" exists',
    'update returns null when the id does not exist',
    'the object previously returned by get() is NOT changed by a later update — no in-place mutation',
    'a patch containing an id does not change the record id',
  ],
  checks: ['node-syntax'],
  risk: 'medium',
});

// The hidden test. The model never sees this; it is the objective scorer.
const HIDDEN_TEST = `import assert from 'node:assert/strict';
import { put, get, all, update } from './store.mjs';

const results = [];
function check(name, fn) {
  try { fn(); results.push([name, true, '']); }
  catch (e) { results.push([name, false, String(e.message).slice(0, 90)]); }
}

check('exports update', () => assert.equal(typeof update, 'function'));
check('merges and returns', () => {
  put('a', { name: 'first', keep: 1 });
  const out = update('a', { name: 'second' });
  assert.equal(out.name, 'second');
  assert.equal(out.keep, 1, 'other fields survive the merge');
});
check('returns null for a missing id', () => {
  assert.equal(update('nope', { x: 1 }), null);
});
check('does NOT mutate the previously returned object', () => {
  put('b', { name: 'before' });
  const snapshot = get('b');
  update('b', { name: 'after' });
  assert.equal(snapshot.name, 'before', 'the earlier object was mutated in place');
});
check('a patch cannot change the id', () => {
  put('c', { name: 'c' });
  const out = update('c', { id: 'hijacked' });
  assert.equal(out.id, 'c');
});
check('put/get/all still work', () => {
  put('d', { name: 'd' });
  assert.equal(get('d').name, 'd');
  assert.ok(all().length >= 1);
  assert.equal(get('absent'), null);
});
console.log(JSON.stringify(results));
`;

async function score(fileBody) {
  const dir = await mkdtemp(join(tmpdir(), 'worker-eval-'));
  try {
    await writeFile(join(dir, 'store.mjs'), fileBody);
    await writeFile(join(dir, 'hidden.test.mjs'), HIDDEN_TEST);
    try { await run(process.execPath, ['--check', join(dir, 'store.mjs')], { timeout: 30000 }); }
    catch (e) { return { parses: false, passed: 0, total: 6, failures: ['file does not parse'] }; }
    const { stdout } = await run(process.execPath, [join(dir, 'hidden.test.mjs')], { timeout: 60000 });
    const rows = JSON.parse(stdout.trim().split('\n').pop());
    return {
      parses: true,
      passed: rows.filter(r => r[1]).length,
      total: rows.length,
      failures: rows.filter(r => !r[1]).map(r => `${r[0]} — ${r[2]}`),
    };
  } catch (error) {
    return { parses: true, passed: 0, total: 6, failures: [`harness: ${String(error.message).slice(0, 120)}`] };
  } finally { await rm(dir, { recursive: true, force: true }); }
}

async function evaluate(runtime, label) {
  const system = await systemPrompt('worker-system');
  const prompt = workerTurn({
    contract,
    files: [{ path: 'sandbox/store.mjs', contents: STORE }],
    checkResults: [], instructions: [], notice: null,
    turn: 1, maxTurns: 14, attempt: 1, maxAttempts: 3,
    checkDescriptions: ['node-syntax: every changed .mjs/.js file parses'],
  });

  const started = Date.now();
  let thinkingChars = 0;
  const response = await runtime.generate('worker', {
    system, prompt, onDelta: d => { if (d.thinking) thinkingChars += d.thinking.length; },
  });
  const ms = Date.now() - started;

  const actions = parseWorkerReply(response.text);
  const writes = actions.filter(a => a.kind === 'FILE');
  const kinds = actions.map(a => a.kind);

  let result = { parses: false, passed: 0, total: 6, failures: ['no file produced'] };
  let preserved = false, mutates = null;
  if (writes.length) {
    result = await score(writes[0].contents);
    const body = writes[0].contents;
    // Did it leave the existing functions alone, byte for byte?
    preserved = ['export function put', 'export function get', 'export function all']
      .every(sig => body.includes(sig)) && body.includes('{ ...value, id }');
    mutates = /records\.get\([^)]*\)\s*\.\w+\s*=/.test(body) || /Object\.assign\(\s*records\.get/.test(body);
  }

  return {
    label, model: response.model, ms, thinkingChars,
    outTpm: response.meta.outputTokensPerMinute,
    promptTpm: response.meta.promptTokensPerMinute,
    outputTokens: response.meta.outputTokens,
    doneReason: response.meta.doneReason,
    protocol: writes.length > 0,
    actions: kinds.join(','),
    truncated: response.meta.doneReason === 'length',
    ...result,
    preserved, mutates,
  };
}

const models = process.argv.slice(2);
if (!models.length) { console.error('usage: worker-eval.mjs <model>...'); process.exit(2); }

const out = [];
for (const raw of models) {
  const nothink = raw.endsWith('!');
  const model = nothink ? raw.slice(0, -1) : raw;
  const config = { ...DEFAULT_CONFIG, roles: { ...DEFAULT_CONFIG.roles,
    worker: { ...DEFAULT_CONFIG.roles.worker, model, think: !nothink, timeoutMs: 30 * 60 * 1000 } } };
  const runtime = new ModelRuntime(config);
  process.stderr.write(`\nworker eval: ${model} …\n`);
  try { out.push(await evaluate(runtime, model)); }
  catch (error) { out.push({ label: model, error: String(error.message).slice(0, 180) }); }
  await runtime.releaseAll();
}

console.log('\n=== base coding: does it UNDERSTAND the file it is editing? ===\n');
for (const r of out) {
  if (r.error) { console.log(`${r.label}\n  ERROR: ${r.error}\n`); continue; }
  const verdict = !r.protocol ? 'NO FILE' : !r.parses ? 'BROKEN' : `${r.passed}/${r.total}`;
  console.log(`${r.label}`);
  console.log(`  hidden tests   ${verdict}${r.passed === r.total ? '  ** correct **' : ''}`);
  console.log(`  protocol       ${r.protocol ? 'ok' : 'FAILED'}  (actions: ${r.actions || 'none'})${r.truncated ? '  TRUNCATED at output limit' : ''}`);
  console.log(`  immutability   ${r.mutates === null ? '?' : r.mutates ? 'MUTATES IN PLACE' : 'clean'}   existing fns ${r.preserved ? 'preserved' : 'CHANGED'}`);
  console.log(`  speed          ${(r.ms / 1000).toFixed(0)}s   ${r.outTpm ?? '?'} out tok/min   ${r.outputTokens ?? '?'} tokens (${r.thinkingChars} chars thinking)`);
  for (const f of (r.failures ?? []).slice(0, 4)) console.log(`    · ${f}`);
  console.log('');
}
