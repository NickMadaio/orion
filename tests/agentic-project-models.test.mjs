import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, realpath, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DEFAULT_CONFIG } from '../scripts/lib/agentic/models.mjs';
import { readProject } from '../scripts/lib/agentic/projects.mjs';
import {
  parseTags, parseCapabilities, discoverModels, applyProjectModels, validateProjectModels, saveProjectModel,
} from '../scripts/lib/agentic/project-models.mjs';

// Fixture names only: nothing in the runtime names a model.
const TAGS = { models: [
  { name: 'alpha:7b', model: 'alpha:7b', size: 4_700_000_000, digest: 'aaa', modified_at: '2026-10-01T00:00:00Z' },
  { name: 'beta-vision:12b', size: 8_100_000_000, digest: 'bbb' },
  { size: 1 }, null,
] };
const config = { ...DEFAULT_CONFIG, memoryBudgetGiB: 40, roles: { worker: { ...DEFAULT_CONFIG.roles.worker, model: 'base:9b' }, reviewer: { ...DEFAULT_CONFIG.roles.reviewer, model: 'base:9b' } } };
const installed = [{ name: 'base:9b', sizeBytes: 6e9 }, { name: 'alpha:7b', sizeBytes: 4.7e9 }];

test('parseTags reads name and size from an /api/tags fixture and skips malformed entries', () => {
  const found = parseTags(TAGS);
  assert.deepEqual(found.map(m => [m.name, m.sizeBytes]), [['alpha:7b', 4_700_000_000], ['beta-vision:12b', 8_100_000_000]]);
  assert.deepEqual(parseTags({}), []);
});

test('parseCapabilities keeps vision and tools, drops plain completion', () => {
  assert.deepEqual(parseCapabilities({ capabilities: ['completion', 'vision', 'tools'] }), ['tools', 'vision']);
  assert.deepEqual(parseCapabilities({}), []);
});

test('discovery is live, and /api/show answers are cached by name and digest', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'orion-pm-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  let shows = 0;
  let tags = TAGS;
  const fetchImpl = async (url, init) => {
    if (url.endsWith('/api/tags')) return { ok: true, json: async () => tags };
    shows += 1;
    const name = JSON.parse(init.body).model;
    return { ok: true, json: async () => ({ capabilities: name.includes('vision') ? ['completion', 'vision'] : ['completion', 'tools'] }) };
  };
  const options = { fetchImpl, cachePath: join(dir, 'cache.json') };
  const first = await discoverModels('http://127.0.0.1:1', options);
  assert.deepEqual(first.map(m => [m.name, m.capabilities]), [['alpha:7b', ['tools']], ['beta-vision:12b', ['vision']]]);
  assert.equal(shows, 2);
  await discoverModels('http://127.0.0.1:1', options);
  assert.equal(shows, 2, 'second call is served from the cache');
  // A model pulled later appears with no code change; only it costs an /api/show.
  tags = { models: [...TAGS.models.slice(0, 2), { name: 'gamma:3b', size: 2e9, digest: 'ggg' }] };
  const third = await discoverModels('http://127.0.0.1:1', options);
  assert.ok(third.some(m => m.name === 'gamma:3b'));
  assert.equal(shows, 3);
  const light = await discoverModels('http://127.0.0.1:1', { ...options, withCapabilities: false });
  assert.equal(shows, 3);
  assert.equal(light.length, 3);
});

test('the project override is what the run config uses', () => {
  const { config: applied, notes } = applyProjectModels(config, { worker: 'alpha:7b' }, installed);
  assert.equal(applied.roles.worker.model, 'alpha:7b');
  assert.equal(applied.roles.reviewer.model, 'base:9b');
  assert.equal(applied.roles.worker.approxResidentGiB, 6);
  assert.equal(config.roles.worker.model, 'base:9b', 'the global config is not mutated');
  assert.match(notes[0], /project worker model: "alpha:7b"/);
});

test('an unset project falls back to the global role models, silently', () => {
  for (const unset of [undefined, null, {}]) {
    const { config: applied, notes } = applyProjectModels(config, unset, installed);
    assert.deepEqual(applied.roles, config.roles);
    assert.deepEqual(notes, []);
  }
});

test('a removed model falls back to the default and says so', () => {
  const { config: applied, notes } = applyProjectModels(config, { worker: 'gone:1b', reviewer: 'alpha:7b' }, installed);
  assert.equal(applied.roles.worker.model, 'base:9b');
  assert.equal(applied.roles.reviewer.model, 'alpha:7b');
  assert.match(notes.join('\n'), /"gone:1b" is not installed in Ollama; using the default worker model "base:9b"/);
});

test('a model too large for the budget falls back; an unreachable Ollama trusts the choice', () => {
  const big = [{ name: 'huge:70b', sizeBytes: 60e9 }];
  const refused = applyProjectModels(config, { worker: 'huge:70b' }, big);
  assert.equal(refused.config.roles.worker.model, 'base:9b');
  assert.match(refused.notes[0], /exceeds the 40 GiB budget/);
  const offline = applyProjectModels(config, { worker: 'alpha:7b' }, null);
  assert.equal(offline.config.roles.worker.model, 'alpha:7b');
});

test('validateProjectModels refuses unknown roles and unsafe names', () => {
  assert.deepEqual(validateProjectModels({ worker: 'a:1', reviewer: null }), { worker: 'a:1' });
  assert.throws(() => validateProjectModels({ judge: 'a:1' }), /unknown model role/);
  assert.throws(() => validateProjectModels({ worker: 'a; rm -rf' }), /not a usable model name/);
});

test('saveProjectModel writes into project.json, readProject returns it, and default clears it', async t => {
  const home = await realpath(await mkdtemp(join(tmpdir(), 'orion-pm-home-')));
  t.after(() => rm(home, { recursive: true, force: true }));
  const { mkdir } = await import('node:fs/promises');
  const root = join(home, 'projects', 'proj-one');
  await mkdir(root, { recursive: true });
  await writeFile(join(root, 'project.json'), JSON.stringify({ version: 1, id: 'proj-one', name: 'P', createdAt: 'x', planFile: 'plan.json', taskCount: 1 }));
  assert.deepEqual(await saveProjectModel(root, 'worker', 'alpha:7b'), { worker: 'alpha:7b' });
  assert.deepEqual((await readProject('proj-one', home)).models, { worker: 'alpha:7b' });
  await saveProjectModel(root, 'worker', 'default');
  assert.equal(JSON.parse(await readFile(join(root, 'project.json'), 'utf8')).models, undefined);
  await assert.rejects(saveProjectModel(root, 'judge', 'a:1'), /role must be/);
  await assert.rejects(saveProjectModel(root, 'worker', 'bad name'), /not a usable/);
});
