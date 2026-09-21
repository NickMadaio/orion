/*
 The write gate. Every file the local worker or reviewer changes passes through
 `assertWritable`, and nothing else in this runtime may write into the repository.

 FOUR CHECKS, ALL OF WHICH MUST PASS

   1. the path is structurally safe        no absolute path, no traversal, no NUL
   2. it resolves INSIDE the worktree      no symlink that leaves it
   3. the task contract's scope allows it  a human approved THIS task to touch it
   4. no deny-list forbids it              ORION's installed policy, plus this
                                           runtime's own self-protection list

 WHY BOTH DENY-LISTS

 `plugin/orion-control/src/self-development-authority.ts` is ORION's existing
 boundary and stays the authority for ORION's own security surfaces. The mission
 says to work inside the existing architecture rather than invent a contradictory
 parallel one, and that is what check 4 does: it LOADS that policy, preferring
 the INSTALLED build for the reason the policy's own comments give — checking a
 proposed edit against the build it is about to change is how a model would
 authorise itself.

 It does not cover the files in this directory, because this directory did not
 exist when it was written. Until a human rebuilds and deploys the plugin, new
 entries in the TypeScript source are not in force. So this runtime carries its
 own list of the surfaces that govern IT, self-referentially including itself.
 Entries were also added to the TypeScript source so the installed policy covers
 them after the next deploy; neither list depends on the other being current.

 FAIL CLOSED

 If the installed policy cannot be loaded at all, nothing is writable. A boundary
 that opens when its rules are missing is not a boundary. This is the difference
 between this module and `orion-selfdev-policy.mjs`, which the Astra handoff
 flagged: that wrapper falls back to the repository build and never calls the
 enablement assertion.
*/
import { createRequire } from 'node:module';
import { existsSync, lstatSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { scopeAllows } from './contract.mjs';

const require = createRequire(import.meta.url);
const INSTALLED_POLICY = join(homedir(), '.openclaw/extensions/orion-control/dist');
const REPO_POLICY = join(import.meta.dirname, '../../../plugin/orion-control/dist');

/*
 The surfaces that govern this runtime. Anchored, repository-root-relative,
 checked before the installed policy so a refusal names the nearer reason.

 The first entry is the load-bearing one: a worker that can edit the code and
 prompts that constrain it can remove its own constraints, and every other rule
 here becomes advisory. It is listed self-referentially for the same reason
 self-development-authority.ts lists itself.
*/
export const RUNTIME_PROTECTED_SURFACES = Object.freeze([
  { pattern: /^scripts\/lib\/agentic\//, reason: 'the local agentic runtime, including this deny-list and the agent operating-system prompts' },
  { pattern: /^scripts\/lib\/orion-project-agent\.mjs$/, reason: 'the durable controller that owns workflow state and the review gates' },
  { pattern: /^scripts\/orion-project-agent$/, reason: 'the operator control CLI' },
  { pattern: /^scripts\/orion-agent$/, reason: 'the supervisor entrypoint' },
  { pattern: /^docs\/agentic\//, reason: 'the mission and architecture that define what this system is for' },
  { pattern: /^scripts\/lib\/orion-selfdev-policy\.mjs$/, reason: "the legacy coder's window onto the self-change policy" },
  { pattern: /^\.git\//, reason: 'git internals — history is not an implementation detail an agent may edit' },
  { pattern: /^\.github\//, reason: 'CI configuration, which decides what "the tests passed" means' },
  { pattern: /^\.env/, reason: 'credentials' },
]);

/*
 Surfaces the worker may not even READ.

 Writes are allowlisted by the task's scope; reads are not, because a model that
 cannot read the caller of the function it is changing writes the wrong function.
 But "read anything in the worktree" is too wide in one specific way: the worker
 can write a file it IS allowed to write, so anything it can read it can copy
 somewhere a human will later read, commit, or publish.

 The worktree is a `git worktree add` checkout, so it contains TRACKED files
 only -- `.env` and the other untracked secrets are simply not present, which is
 most of the protection. What IS tracked and does not belong in a model's
 context is Nick's personal material: `var/brain/` is his Obsidian vault.

 This is defence in depth, not a guarantee. A determined model could read a
 permitted file that quotes something sensitive. It closes the obvious hole.
*/
export const UNREADABLE_SURFACES = Object.freeze([
  { pattern: /^var\/brain\//, reason: "Nick's personal Obsidian vault" },
  { pattern: /^var\/data\//, reason: 'personal runtime data' },
  { pattern: /(^|\/)\.env($|\.)/, reason: 'credentials' },
  { pattern: /(^|\/)(id_rsa|id_ed25519|.*\.pem|.*\.p12|.*\.key)$/, reason: 'private key material' },
  { pattern: /^\.git\//, reason: 'git internals, including any credential helper configuration' },
]);

export function unreadableSurface(relativePath) {
  return UNREADABLE_SURFACES.find(surface => surface.pattern.test(relativePath));
}

let cachedPolicy;

/** Load ORION's compiled self-change policy, installed build preferred. */
export function loadInstalledPolicy({ refresh = false } = {}) {
  if (cachedPolicy && !refresh) return cachedPolicy;
  for (const [dir, source] of [[INSTALLED_POLICY, 'installed'], [REPO_POLICY, 'repo']]) {
    const file = join(dir, 'self-development-authority.js');
    if (!existsSync(file)) continue;
    try {
      const module = require(file);
      if (typeof module.assertDiffAllowed !== 'function') continue;
      cachedPolicy = { module, source, dir };
      return cachedPolicy;
    } catch { /* try the next location; a broken build is the same as an absent one */ }
  }
  cachedPolicy = { module: null, source: 'none', dir: null };
  return cachedPolicy;
}

export class BoundaryError extends Error {
  constructor(path, reason, layer) {
    super(`refused to write "${path}": ${reason}`);
    this.name = 'BoundaryError';
    this.path = path;
    this.reason = reason;
    this.layer = layer;
  }
}

function structurallySafe(relativePath) {
  if (typeof relativePath !== 'string' || !relativePath) return 'path must be a non-empty string';
  if (relativePath.includes('\0')) return 'path must not contain a NUL byte';
  if (relativePath.startsWith('/') || relativePath.startsWith('~')) return 'path must be repository-relative';
  if (relativePath === '..' || relativePath.startsWith('../') || relativePath.includes('/../')) return 'path must not traverse above the repository root';
  if (relativePath.endsWith('/')) return 'path must name a file, not a directory';
  if (relativePath.split('/').some(segment => segment === '' || segment === '.')) return 'path must not contain empty or "." segments';
  return null;
}

/*
 Symlink containment. `realpathSync` is applied to the nearest EXISTING ancestor
 rather than to the target, because the target legitimately may not exist yet on
 a create. Resolving the ancestor catches the real attack — a directory inside
 the worktree that is a symlink to somewhere else — which is the hazard the
 Astra handoff recorded against the legacy coder ("follows target symlinks").
*/
function resolvesInside(worktree, relativePath) {
  let realRoot;
  try { realRoot = realpathSync(worktree); } catch { return 'the worktree does not exist'; }
  const absolute = resolve(realRoot, relativePath);
  // `lstat`, not `existsSync`: a DANGLING symlink does not "exist" by
  // `existsSync`, so walking past it would resolve the ancestor above it and
  // then write straight through the link to wherever it points.
  const present = candidate => { try { lstatSync(candidate); return true; } catch { return false; } };
  let probe = absolute;
  while (!present(probe)) {
    const parent = dirname(probe);
    if (parent === probe) return 'no existing ancestor directory';
    probe = parent;
  }
  let realProbe;
  try { realProbe = realpathSync(probe); } catch { return 'path could not be resolved'; }
  const within = realProbe === realRoot || realProbe.startsWith(realRoot + sep);
  if (!within) return 'path resolves outside the worktree through a symlink';
  // Re-derive the repository-relative path from the RESOLVED location, so the
  // deny-lists below are matched against where the write actually lands.
  const tail = relative(probe, absolute);
  const resolvedRelative = relative(realRoot, tail ? join(realProbe, tail) : realProbe);
  return { resolvedRelative };
}

export function runtimeProtectedSurface(relativePath) {
  return RUNTIME_PROTECTED_SURFACES.find(surface => surface.pattern.test(relativePath));
}

/**
 * Throws `BoundaryError` unless every layer permits writing `relativePath`.
 * `contract` is a normalized task contract; its `scope` is the allowlist.
 */
export function assertWritable(worktree, relativePath, contract) {
  const structural = structurallySafe(relativePath);
  if (structural) throw new BoundaryError(String(relativePath), structural, 'structure');

  const containment = resolvesInside(worktree, relativePath);
  if (typeof containment === 'string') throw new BoundaryError(relativePath, containment, 'containment');
  const effective = containment.resolvedRelative;
  if (effective !== relativePath) {
    const nested = structurallySafe(effective);
    if (nested) throw new BoundaryError(relativePath, `resolves to an unusable location (${nested})`, 'containment');
  }

  if (!contract || !Array.isArray(contract.scope)) throw new BoundaryError(relativePath, 'no task contract scope is in force', 'scope');
  if (!scopeAllows(contract.scope, effective)) {
    throw new BoundaryError(relativePath,
      `task "${contract.id}" was approved to change only: ${contract.scope.join(', ')}`, 'scope');
  }

  for (const candidate of new Set([relativePath, effective])) {
    const runtime = runtimeProtectedSurface(candidate);
    if (runtime) throw new BoundaryError(candidate, `that is ${runtime.reason}. No task scope reopens it.`, 'runtime-policy');
  }

  const { module, source } = loadInstalledPolicy();
  if (!module) {
    throw new BoundaryError(relativePath,
      "ORION's compiled self-change policy could not be loaded from the installed plugin or the repository build. " +
      'Nothing is writable while the boundary is missing; build the plugin (npm run build in plugin/orion-control) and retry.',
      'policy-unavailable');
  }
  try {
    module.assertDiffAllowed([effective]);
  } catch (error) {
    throw new BoundaryError(effective, `${error?.message ?? error} (${source} policy)`, 'orion-policy');
  }
  return effective;
}

/** Report, without throwing, which paths a contract's scope could never reach. */
export function auditContractScope(contract) {
  const { module, source } = loadInstalledPolicy();
  const findings = [];
  for (const entry of contract.scope) {
    const probe = entry.endsWith('/') ? `${entry}probe.txt` : entry;
    const runtime = runtimeProtectedSurface(probe) ?? runtimeProtectedSurface(entry);
    if (runtime) { findings.push({ entry, layer: 'runtime-policy', reason: runtime.reason }); continue; }
    if (!module) { findings.push({ entry, layer: 'policy-unavailable', reason: 'no compiled policy' }); continue; }
    try { module.assertDiffAllowed([probe]); }
    catch (error) { findings.push({ entry, layer: 'orion-policy', reason: String(error?.message ?? error) }); }
  }
  return { policySource: source, findings };
}
