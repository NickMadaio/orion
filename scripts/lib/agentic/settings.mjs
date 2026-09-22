/*
 Reading and writing the operator's agentic settings.

 WHY THIS IS SEPARATE FROM THE CONTROLLER

 Model choice is not run state. Changing the reviewer mid-run affects the NEXT
 generation and must never touch the checkpoint currently under review, so it
 does not go through the controller's revisioned transaction — treating it as
 workflow state would make a settings tweak able to invalidate an in-flight
 review.

 WHAT THE UI MAY AND MAY NOT CHANGE

 Models and the tuning limits, yes: those are preferences, and Nick asked to set
 them without editing JSON by hand.

 `enabled` — whether a model may change real code while nobody is watching —
 stays a deliberate file edit. It is the one switch whose whole value is that
 moving it takes intent, and a toggle in a window is not that. `setRoleModel`
 will not write it, and `readSettings` only reports it.
*/
import { readFile, writeFile, mkdir, rename } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { CONFIG_PATH, loadAgenticConfig, installedModels, DEFAULT_CONFIG } from './models.mjs';

/** A model name Ollama could actually resolve. Rejects shell metacharacters. */
const MODEL_PATTERN = /^[A-Za-z0-9._/:-]{1,200}$/;

export async function readSettings({ path = CONFIG_PATH } = {}) {
  const config = await loadAgenticConfig({ path });
  let installed = [];
  try { installed = await installedModels(config.endpoint); } catch { /* offline is a normal state */ }
  return {
    path,
    exists: config.source !== 'defaults',
    enabled: config.enabled,
    endpoint: config.endpoint,
    roles: Object.fromEntries(Object.entries(config.roles).map(([role, spec]) => [role, {
      model: spec.model, contextTokens: spec.contextTokens, approxResidentGiB: spec.approxResidentGiB,
      think: spec.think, temperature: spec.temperature,
      installed: installed.includes(spec.model),
    }])),
    limits: config.limits,
    installed,
    // The UI shows this rather than offering a switch; see the header.
    enabledIsFileOnly: true,
  };
}

/**
 * Point a role at a different model. Refuses a model that is not installed,
 * because a config naming an absent model fails at 02:00 instead of now.
 */
export async function setRoleModel(role, model, { path = CONFIG_PATH } = {}) {
  if (!['worker', 'reviewer'].includes(role)) throw new Error('role must be worker or reviewer');
  if (typeof model !== 'string' || !MODEL_PATTERN.test(model)) throw new Error(`"${model}" is not a usable model name`);

  const config = await loadAgenticConfig({ path });
  let installed = [];
  try { installed = await installedModels(config.endpoint); }
  catch (error) { throw new Error(`cannot reach the inference runtime to verify "${model}": ${error.message}`); }
  if (!installed.includes(model)) {
    throw new Error(`"${model}" is not installed. Available: ${installed.join(', ') || 'none'}`);
  }

  let raw = {};
  try { raw = JSON.parse(await readFile(path, 'utf8')); } catch { /* first write */ }
  const next = {
    ...raw,
    roles: { ...(raw.roles ?? {}), [role]: { ...(raw.roles?.[role] ?? {}), model } },
  };
  // `enabled` is never written here. If the file did not exist, it stays absent,
  // which means OFF — creating a config must not be a way to enable the agent.
  delete next.enabled;
  if (raw.enabled !== undefined) next.enabled = raw.enabled;

  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = join(dirname(path), `${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(next, null, 2) + '\n', { mode: 0o600 });
  await rename(temporary, path);
  return readSettings({ path });
}

/** The models this machine could be pointed at, with the defaults marked. */
export async function modelChoices({ path = CONFIG_PATH } = {}) {
  const settings = await readSettings({ path });
  return {
    installed: settings.installed,
    current: Object.fromEntries(Object.entries(settings.roles).map(([role, spec]) => [role, spec.model])),
    defaults: Object.fromEntries(Object.entries(DEFAULT_CONFIG.roles).map(([role, spec]) => [role, spec.model])),
  };
}
