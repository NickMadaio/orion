/*
 Per-project model choice, and live discovery of what Ollama has.

 NOTHING HERE NAMES A MODEL. The list comes from Ollama's own /api/tags, and a
 project's choice is whatever string was saved in its record. A model pulled
 this afternoon shows up the next time anyone asks, with no code change.

 The choice is an OVERRIDE of a global role: `{ worker?: name, reviewer?: name }`
 in project.json. Absent means "use the global role model". A choice that points
 at a model Ollama no longer has is not an error at 02:00: the run falls back to
 the global model for that role and says so, in a note the caller prints to the
 run log, because a run that silently used a different model than the one shown
 would make every later benchmark claim untrue.
*/
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONFIG_PATH } from './models.mjs';

export const PROJECT_MODEL_ROLES = Object.freeze(['worker', 'reviewer']);
const MODEL_PATTERN = /^[A-Za-z0-9._/:-]{1,200}$/;
const GIB = 1024 ** 3;

/** Validate a saved `models` object. Unknown roles and bad names are refused by name. */
export function validateProjectModels(models) {
  if (models === undefined || models === null) return {};
  if (typeof models !== 'object' || Array.isArray(models)) throw new Error('models must be an object');
  const result = {};
  for (const [role, name] of Object.entries(models)) {
    if (!PROJECT_MODEL_ROLES.includes(role)) throw new Error(`unknown model role "${role}"`);
    if (name === undefined || name === null) continue;
    if (typeof name !== 'string' || !MODEL_PATTERN.test(name)) throw new Error(`"${name}" is not a usable model name`);
    result[role] = name;
  }
  return result;
}

/** /api/tags body -> [{ name, sizeBytes, modifiedAt, digest }], skipping malformed entries. */
export function parseTags(body) {
  const models = Array.isArray(body?.models) ? body.models : [];
  return models.flatMap(entry => {
    const name = entry?.name ?? entry?.model;
    if (typeof name !== 'string' || !name) return [];
    return [{ name, sizeBytes: Number.isFinite(entry.size) ? entry.size : 0,
      modifiedAt: entry.modified_at ?? null, digest: entry.digest ?? null }];
  });
}

/** /api/show body -> capability words ("vision", "tools", "thinking", ...), minus plain completion. */
export function parseCapabilities(body) {
  const list = Array.isArray(body?.capabilities) ? body.capabilities : [];
  return list.filter(word => typeof word === 'string' && word !== 'completion').sort();
}

async function readCache(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch { return {}; }
}

/**
 * Everything installed, with size and capabilities. /api/show is one call per
 * model, so each answer is cached by name + digest: a re-pulled model has a new
 * digest and is asked again, an unchanged one never is.
 */
export async function discoverModels(endpoint, {
  fetchImpl = fetch,
  withCapabilities = true,
  cachePath = join(dirname(CONFIG_PATH), 'model-capabilities.json'),
} = {}) {
  const response = await fetchImpl(`${endpoint}/api/tags`, { signal: AbortSignal.timeout(10_000) });
  if (!response.ok) throw new Error(`ollama /api/tags returned ${response.status}`);
  const installed = parseTags(await response.json());
  if (!withCapabilities) return installed.map(model => ({ ...model, capabilities: [] }));
  const cache = await readCache(cachePath);
  let dirty = false;
  const next = {};
  const models = [];
  for (const model of installed) {
    const key = `${model.name}@${model.digest ?? ''}`;
    let capabilities = cache[key];
    if (!Array.isArray(capabilities)) {
      try {
        const shown = await fetchImpl(`${endpoint}/api/show`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: model.name }), signal: AbortSignal.timeout(10_000),
        });
        capabilities = shown.ok ? parseCapabilities(await shown.json()) : null;
      } catch { capabilities = null; }
      dirty = true;
    }
    if (Array.isArray(capabilities)) next[key] = capabilities;
    models.push({ ...model, capabilities: capabilities ?? [] });
  }
  if (dirty) {
    try {
      await mkdir(dirname(cachePath), { recursive: true, mode: 0o700 });
      const temporary = `${cachePath}.${randomUUID()}.tmp`;
      await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
      await rename(temporary, cachePath);
    } catch { /* a cache that cannot be written is only a slower next time */ }
  }
  return models;
}

/**
 * Apply a project's choices to the global config. Pure: returns a new config and
 * the notes to print. `installed` is [{ name, sizeBytes }] from discovery, or
 * null when Ollama could not be asked (then the choice is used as given and the
 * normal startup probe is what refuses an absent model).
 */
export function applyProjectModels(config, projectModels, installed) {
  const chosen = validateProjectModels(projectModels);
  const notes = [];
  const roles = { ...config.roles };
  for (const role of PROJECT_MODEL_ROLES) {
    const name = chosen[role];
    if (!name || name === roles[role].model) continue;
    const fallback = roles[role].model;
    const found = installed?.find(entry => entry.name === name);
    if (installed && !found) {
      notes.push(`project ${role} model "${name}" is not installed in Ollama; using the default ${role} model "${fallback}" for this run`);
      continue;
    }
    // Resident size: file size plus ~25% for the KV cache at the configured
    // context. Rougher than the measured figure for the default model, but it
    // is only used to refuse a model that cannot fit the budget.
    const approx = found?.sizeBytes > 0 ? Math.max(1, Math.ceil((found.sizeBytes / GIB) * 1.25)) : roles[role].approxResidentGiB;
    if (approx > config.memoryBudgetGiB) {
      notes.push(`project ${role} model "${name}" (~${approx} GiB) exceeds the ${config.memoryBudgetGiB} GiB budget; using the default ${role} model "${fallback}" for this run`);
      continue;
    }
    roles[role] = { ...roles[role], model: name, approxResidentGiB: approx };
    notes.push(`project ${role} model: "${name}" (default is "${fallback}")`);
  }
  return { config: { ...config, roles }, notes };
}

/** Save (or clear, with null / "default") one role's model in a project's record. */
export async function saveProjectModel(root, role, model) {
  if (!PROJECT_MODEL_ROLES.includes(role)) throw new Error('role must be worker or reviewer');
  const clear = model === null || model === 'default';
  if (!clear && (typeof model !== 'string' || !MODEL_PATTERN.test(model))) throw new Error(`"${model}" is not a usable model name`);
  const file = join(root, 'project.json');
  const record = JSON.parse(await readFile(file, 'utf8'));
  const models = { ...(record.models ?? {}) };
  if (clear) delete models[role]; else models[role] = model;
  const next = { ...record };
  if (Object.keys(models).length) next.models = models; else delete next.models;
  const temporary = `${file}.tmp-${process.pid}-${randomUUID()}`;
  await writeFile(temporary, JSON.stringify(next, null, 2), { mode: 0o600, flag: 'wx' });
  await rename(temporary, file);
  return next.models ?? {};
}
