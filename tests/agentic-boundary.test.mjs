import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertWritable, auditContractScope, loadInstalledPolicy, runtimeProtectedSurface, unreadableSurface } from '../scripts/lib/agentic/boundary.mjs';
import { readScoped } from '../scripts/lib/agentic/workspace.mjs';
import { normalizeTaskContract } from '../scripts/lib/agentic/contract.mjs';

const contract = scope => normalizeTaskContract({
  id: 'bounded-task', title: 'Bounded', objective: 'stay inside the fence', weight: 1,
  dependencies: [], scope, checks: ['node-syntax'], acceptance: ['it stayed inside'],
});

async function worktree(t) {
  const root = await mkdtemp(join(tmpdir(), 'orion-boundary-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts/lib/agentic'), { recursive: true });
  await mkdir(join(root, 'sandbox/nested'), { recursive: true });
  await mkdir(join(root, 'plugin/orion-control/src'), { recursive: true });
  await writeFile(join(root, 'sandbox/file.mjs'), 'export const a = 1;\n');
  return root;
}

test('a path inside scope is writable and the resolved path is returned', async t => {
  const root = await worktree(t);
  assert.equal(assertWritable(root, 'sandbox/file.mjs', contract(['sandbox/'])), 'sandbox/file.mjs');
  // A file that does not exist yet is fine; its ancestor is what gets resolved.
  assert.equal(assertWritable(root, 'sandbox/nested/new.mjs', contract(['sandbox/'])), 'sandbox/nested/new.mjs');
});

test('scope is an allowlist: a neighbouring file is refused before any bytes are written', async t => {
  const root = await worktree(t);
  const only = contract(['sandbox/file.mjs']);
  assert.throws(() => assertWritable(root, 'sandbox/nested/other.mjs', only), error => {
    assert.equal(error.name, 'BoundaryError');
    assert.equal(error.layer, 'scope');
    // The refusal names the file AND what was approved. "Denied" alone is the
    // message that produces retry loops.
    assert.match(error.message, /approved to change only/);
    return true;
  });
});

test('structurally unusable paths are refused before anything touches the filesystem', async t => {
  const root = await worktree(t);
  const wide = contract(['sandbox/']);
  for (const [path, layer] of [
    ['/etc/passwd', 'structure'], ['~/secret', 'structure'], ['../escape.mjs', 'structure'],
    ['sandbox/../../escape.mjs', 'structure'], ['sandbox/', 'structure'], ['sandbox/./a.mjs', 'structure'],
    ['sandbox/a\0b.mjs', 'structure'],
  ]) {
    assert.throws(() => assertWritable(root, path, wide), error => {
      assert.equal(error.layer, layer, `${path} should be refused at the ${layer} layer`);
      return true;
    }, `${path} should be refused`);
  }
});

test('a symlinked directory inside the worktree cannot be used to write outside it', async t => {
  const root = await worktree(t);
  const outside = await mkdtemp(join(tmpdir(), 'orion-outside-'));
  t.after(() => rm(outside, { recursive: true, force: true }));
  await symlink(outside, join(root, 'sandbox/escape'));
  assert.throws(() => assertWritable(root, 'sandbox/escape/evil.mjs', contract(['sandbox/'])), error => {
    assert.equal(error.layer, 'containment');
    assert.match(error.message, /outside the worktree through a symlink/);
    return true;
  });
});

test('a DANGLING symlink is not walked past as if it were absent', async t => {
  const root = await worktree(t);
  const outside = join(tmpdir(), `orion-nonexistent-${Date.now()}`);
  // The target does not exist, so `existsSync` on the link is false. An
  // implementation that used it would walk up to `sandbox/` and happily write
  // straight through the link the moment the target appeared.
  await symlink(outside, join(root, 'sandbox/dangling'));
  assert.throws(() => assertWritable(root, 'sandbox/dangling', contract(['sandbox/'])), error => {
    assert.equal(error.layer, 'containment');
    return true;
  });
});

test("the runtime's own surfaces are refused no matter what scope a task was given", async t => {
  const root = await worktree(t);
  for (const path of [
    'scripts/lib/agentic/boundary.mjs',
    'scripts/lib/agentic/prompts/worker-system.md',
    'scripts/lib/orion-project-agent.mjs',
    'scripts/orion-project-agent',
    'scripts/orion-agent',
    'docs/agentic/LOCAL_AGENTIC_DEVELOPMENT_MISSION.md',
    '.github/workflows/ci.yml',
    '.env',
  ]) {
    // Deliberately given a scope that DOES cover the file: the point is that
    // scope does not reopen it. A worker that can edit the code and prompts
    // constraining it can remove its own constraints.
    assert.throws(() => assertWritable(root, path, contract([path])), error => {
      assert.equal(error.layer, 'runtime-policy', `${path} should hit the runtime deny-list`);
      assert.match(error.message, /No task scope reopens it/);
      return true;
    }, `${path} must be refused`);
  }
});

test('the deny-list refuses to remove itself from its own deny-list', () => {
  assert.ok(runtimeProtectedSurface('scripts/lib/agentic/boundary.mjs'));
  assert.ok(runtimeProtectedSurface('scripts/lib/agentic/checks.mjs'));
  assert.equal(runtimeProtectedSurface('scripts/lib/widget.mjs'), undefined);
});

test("ORION's own installed policy is consulted and its refusals are surfaced", async t => {
  const root = await worktree(t);
  const policy = loadInstalledPolicy();
  // If this ever fails, the runtime is fail-closed and nothing is writable —
  // which is the intended behaviour, but it should be loud rather than assumed.
  assert.ok(policy.module, 'a compiled self-development-authority.js must be loadable');
  assert.ok(['installed', 'repo'].includes(policy.source));

  for (const path of ['plugin/orion-control/src/approvals.ts', 'plugin/orion-control/src/catalog.ts']) {
    assert.throws(() => assertWritable(root, path, contract([path])), error => {
      assert.equal(error.layer, 'orion-policy', `${path} should be refused by ORION's own policy`);
      return true;
    });
  }
});

test('a scope that could never be written is reported by the plan audit, not discovered at 02:00', () => {
  const audit = auditContractScope(contract(['plugin/orion-control/src/approvals.ts', 'scripts/lib/agentic/']));
  assert.equal(audit.findings.length, 2);
  assert.ok(audit.findings.some(finding => finding.layer === 'orion-policy'));
  assert.ok(audit.findings.some(finding => finding.layer === 'runtime-policy'));
  assert.equal(auditContractScope(contract(['sandbox/'])).findings.length, 0);
});

test('a contract with no scope array cannot authorise anything', async t => {
  const root = await worktree(t);
  assert.throws(() => assertWritable(root, 'sandbox/file.mjs', null), /no task contract scope is in force/);
  assert.throws(() => assertWritable(root, 'sandbox/file.mjs', {}), /no task contract scope is in force/);
});

test('personal and key material cannot be READ into a model\'s context', async t => {
  const root = await worktree(t);
  await mkdir(join(root, 'var/brain'), { recursive: true });
  await writeFile(join(root, 'var/brain/journal.md'), 'a private note');
  // Reads are otherwise unrestricted on purpose — a worker that cannot read the
  // caller of the function it is changing writes the wrong function. But
  // anything it can read it can copy into a file it IS allowed to write.
  await assert.rejects(readScoped(root, 'var/brain/journal.md'), /personal Obsidian vault/);
  for (const path of ['.env', 'config/.env.local', 'keys/deploy.pem', 'secrets/id_ed25519', '.git/config']) {
    assert.ok(unreadableSurface(path), `${path} should be unreadable`);
  }
  // An ordinary source file is still readable; the gate is narrow by design.
  assert.match(await readScoped(root, 'sandbox/file.mjs'), /export const a/);
  assert.equal(unreadableSurface('scripts/lib/agentic/worker.mjs'), undefined);
});
