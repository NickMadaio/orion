import test from 'node:test';
import assert from 'node:assert/strict';
import {
  contractDigest, normalizeReviewContract, normalizeTaskContract, normalizeTaskGraph, scopeAllows,
} from '../scripts/lib/agentic/contract.mjs';

const base = () => ({
  id: 'add-widget', title: 'Add the widget', objective: 'A widget exists and is reachable',
  weight: 3, dependencies: [], scope: ['scripts/lib/widget.mjs'], checks: ['node-syntax'],
  acceptance: ['the widget module exports build()'],
});

test('a contract without scope or checks is not a contract', () => {
  for (const missing of ['scope', 'checks', 'acceptance', 'objective', 'title']) {
    const raw = base();
    delete raw[missing];
    assert.throws(() => normalizeTaskContract(raw), /invalid task contract/, `${missing} should be required`);
  }
  for (const empty of ['scope', 'checks', 'acceptance']) {
    assert.throws(() => normalizeTaskContract({ ...base(), [empty]: [] }), /must not be empty/);
  }
});

test('scope entries cannot escape the repository or smuggle a glob', () => {
  for (const entry of ['/etc/passwd', '~/secrets', '../outside.mjs', 'a/../../b', './rel.mjs',
    'scripts/**/*.mjs', 'scripts/*.mjs', 'a//b.mjs']) {
    assert.throws(() => normalizeTaskContract({ ...base(), scope: [entry] }),
      /invalid task contract/, `"${entry}" should be refused`);
  }
});

test('scopeAllows matches exact files and directory prefixes, and nothing else', () => {
  const scope = ['scripts/lib/widget.mjs', 'docs/widget/'];
  assert.equal(scopeAllows(scope, 'scripts/lib/widget.mjs'), true);
  assert.equal(scopeAllows(scope, 'docs/widget/readme.md'), true);
  assert.equal(scopeAllows(scope, 'docs/widget/deep/nested.md'), true);
  // The near misses are the ones that matter: a prefix that is not a directory
  // boundary, a sibling, and anything that climbs out.
  assert.equal(scopeAllows(scope, 'scripts/lib/widget.mjs.bak'), false);
  assert.equal(scopeAllows(scope, 'docs/widgets/other.md'), false);
  assert.equal(scopeAllows(scope, 'scripts/lib/other.mjs'), false);
  assert.equal(scopeAllows(scope, '../docs/widget/x.md'), false);
  assert.equal(scopeAllows(scope, 'docs/widget/../../.env'), false);
  assert.equal(scopeAllows(scope, '/docs/widget/x.md'), false);
});

test('the digest changes when the contract text changes and not when runtime status does', () => {
  const contract = normalizeTaskContract(base());
  const original = contractDigest(contract);
  assert.equal(contractDigest(normalizeTaskContract(base())), original, 'same text, same digest');
  // Runtime fields are not part of the contract's identity.
  assert.equal(contractDigest(normalizeTaskContract({ ...base(), status: 'running', attempts: 2 })), original);
  for (const change of [{ objective: 'something else' }, { acceptance: ['different'] },
    { scope: ['scripts/lib/other.mjs'] }, { rev: 2 }, { nonScope: ['do not touch tests'] }]) {
    assert.notEqual(contractDigest(normalizeTaskContract({ ...base(), ...change })), original,
      `${Object.keys(change)[0]} must change the digest`);
  }
});

test('a graph refuses duplicates, dangling dependencies and cycles', () => {
  const second = { ...base(), id: 'use-widget', dependencies: ['add-widget'] };
  assert.equal(normalizeTaskGraph([base(), second]).length, 2);
  // Two independent tasks that happen to share an id — not a self-dependency,
  // which has its own earlier refusal.
  assert.throws(() => normalizeTaskGraph([base(), { ...base(), title: 'A clash' }]), /duplicate task id/);
  assert.throws(() => normalizeTaskGraph([base(), { ...second, dependencies: ['absent'] }]), /names no task/);
  assert.throws(() => normalizeTaskGraph([{ ...base(), dependencies: ['use-widget'] }, second]), /cycle/);
  assert.throws(() => normalizeTaskContract({ ...base(), dependencies: ['add-widget'] }), /may not depend on itself/);
});

test('a review that contradicts itself is rejected rather than resolved charitably', () => {
  const ok = { verdict: 'PASS', summary: 'fine', passed: ['criterion 1'], failed: [] };
  assert.equal(normalizeReviewContract(ok, { taskId: 'add-widget', contractDigest: 'abc' }).advancement, true);

  // PASS carrying a blocking finding is a model contradicting itself. Resolving
  // it either way silently would be the orchestrator guessing.
  assert.throws(() => normalizeReviewContract({
    ...ok, failed: [{ criterion: 'c', severity: 'blocking', evidence: 'e' }],
  }, { taskId: 'a', contractDigest: 'b' }), /PASS cannot carry/);

  assert.throws(() => normalizeReviewContract({ ...ok, verdict: 'PASS_WITH_TASKS' },
    { taskId: 'a', contractDigest: 'b' }), /requires at least one correction/);

  assert.throws(() => normalizeReviewContract({ ...ok, corrections: [{ title: 'x' }] },
    { taskId: 'a', contractDigest: 'b' }), /only permitted with PASS_WITH_TASKS/);

  assert.throws(() => normalizeReviewContract({ ...ok, verdict: 'BLOCKED' },
    { taskId: 'a', contractDigest: 'b' }), /requires escalationReason/);

  assert.throws(() => normalizeReviewContract({ ...ok, verdict: 'looks fine to me' },
    { taskId: 'a', contractDigest: 'b' }), /verdict must be one of/);
});

test('BLOCKED never permits advancement', () => {
  const review = normalizeReviewContract({
    verdict: 'BLOCKED', summary: 'ambiguous', escalationReason: 'two defensible designs',
    escalationKind: 'architecture',
  }, { taskId: 'add-widget', contractDigest: 'abc' });
  assert.equal(review.advancement, false);
  assert.equal(review.escalationKind, 'architecture');
});

test('oversized and NUL-bearing text is refused, not truncated into something plausible', () => {
  assert.throws(() => normalizeTaskContract({ ...base(), objective: 'x'.repeat(2001) }), /exceeds/);
  assert.throws(() => normalizeTaskContract({ ...base(), title: 'a\0b' }), /NUL/);
  assert.throws(() => normalizeTaskContract({ ...base(), weight: 0 }), /weight/);
  assert.throws(() => normalizeTaskContract({ ...base(), weight: 101 }), /weight/);
  assert.throws(() => normalizeTaskContract({ ...base(), id: 'Not-Kebab' }), /kebab-case/);
  assert.throws(() => normalizeTaskContract({ ...base(), checks: ['rm -rf /'] }), /is not a registry name/);
});

test('an empty optional field is absent, not invalid', () => {
  // Found on the FIRST live reviewer run. Models fill optional string fields
  // with "" as a matter of course, and rejecting that threw away a correct
  // PASS_WITH_TASKS review — which in production retries once, fails the same
  // way, and escalates: Nick woken to be told about a review that was right.
  const sound = {
    verdict: 'PASS_WITH_TASKS', summary: 'sound, one fix remains',
    passed: ['criterion 1'], failed: [{ criterion: 'c', severity: 'minor', evidence: 'e' }],
    corrections: [{ title: 'Fix it', objective: 'o', acceptance: ['a'] }],
  };
  for (const empty of ['', null, undefined]) {
    const review = normalizeReviewContract({ ...sound, escalationKind: empty, escalationReason: empty },
      { taskId: 'add-widget', contractDigest: 'abc' });
    assert.equal(review.escalationKind, null);
    assert.equal(review.verdict, 'PASS_WITH_TASKS');
  }
  // A real value still survives, and BLOCKED still demands a reason — the
  // leniency must not reach the field that actually gates an escalation.
  assert.equal(normalizeReviewContract({ ...sound, escalationKind: 'architecture' },
    { taskId: 'a', contractDigest: 'b' }).escalationKind, 'architecture');
  assert.throws(() => normalizeReviewContract({ verdict: 'BLOCKED', summary: 's', escalationReason: '' },
    { taskId: 'a', contractDigest: 'b' }), /requires escalationReason/);
});
