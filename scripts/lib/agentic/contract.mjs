/*
 Task and review contracts — the schema authority for the local agentic runtime.

 Pure functions over plain objects. No filesystem, no network, no model. This
 module is imported by the durable controller, by the prompt builder, by the
 boundary check and by the reviewer, so that "what a task IS" has exactly one
 definition. A second definition is a lie with a delay fuse.

 WHY EVERY FIELD IS HERE

 The mission calls bureaucracy for its own sake a failure. Each field below is
 read by something that acts on it:

   objective/context/constraints/nonScope   go into the worker prompt and are
                                            what the reviewer checks against
   brief                                    reference material the host loads
                                            from files beside the plan (see
                                            plan.mjs). Rendered after the
                                            contract, for worker, reviewer and
                                            repair alike. It informs; it grants
                                            nothing -- scope and acceptance still
                                            govern
   scope                                    IS the write gate (boundary.mjs);
                                            a file not in scope cannot be
                                            written, whatever the model decides
   checks                                   names entries in the fixed-argv
                                            check registry — the ONLY commands
                                            that run. Never a shell string.
   acceptance                               what PASS means, in the reviewer's
                                            own output schema
   risk/reviewDepth                         risk triggers worker self-review; reviewDepth
                                            guides the reviewer prompt. Neither
                                            expands authority or retry budgets
   weight/dependencies                      scheduling and honest progress
   origin/originReview                      provenance: this is how Astra sees
                                            that a task was authored by a review
                                            rather than by the approved plan

 WHY `scope` IS AN ALLOWLIST AND NOT A DENY-LIST

 A deny-list answers "what may this never touch"; the installed plugin policy
 already answers that and is the floor. `scope` answers a different and stricter
 question: "what did a human approve THIS task to change". Ten unattended hours
 are only worth having if they were spent inside the thing that was asked for,
 and an allowlist is the only shape that survives a model deciding a neighbouring
 file would be easier to fix.
*/
import { createHash } from 'node:crypto';

export const ID_PATTERN = /^[a-z0-9][a-z0-9-]{1,63}$/;
export const RISKS = ['low', 'medium', 'high'];
export const REVIEW_DEPTHS = ['light', 'standard', 'deep'];
export const ORIGINS = ['plan', 'review_correction', 'reviewer_repair', 'operator'];
export const VERDICTS = ['PASS', 'PASS_WITH_TASKS', 'BLOCKED'];
export const SEVERITIES = ['minor', 'major', 'blocking'];

const MAX_TEXT = 2000;
const MAX_LIST = 40;
/*
 A brief is common.md plus the task's own file (plan.mjs). 18,000 characters is
 about 6,000 tokens by context.mjs's estimate: an eighth of the worker's input
 budget, leaving the working set room for eight real files. More than that and
 the brief starts evicting the code it is describing.
*/
export const MAX_BRIEF = 18_000;

function fail(message) { throw new Error(`invalid task contract: ${message}`); }

function text(value, field, { max = MAX_TEXT, required = true } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(`${field} is required`);
    return '';
  }
  if (typeof value !== 'string') fail(`${field} must be a string`);
  const trimmed = value.trim();
  if (required && !trimmed) fail(`${field} must not be empty`);
  if (trimmed.length > max) fail(`${field} exceeds ${max} characters`);
  if (trimmed.includes('\0')) fail(`${field} must not contain a NUL byte`);
  return trimmed;
}

function list(value, field, { required = false, max = MAX_LIST, itemMax = MAX_TEXT } = {}) {
  if (value === undefined || value === null) {
    if (required) fail(`${field} is required`);
    return [];
  }
  if (!Array.isArray(value)) fail(`${field} must be an array`);
  if (required && !value.length) fail(`${field} must not be empty`);
  if (value.length > max) fail(`${field} has more than ${max} entries`);
  return value.map((item, index) => text(item, `${field}[${index}]`, { max: itemMax }));
}

/*
 Scope entries are deliberately NOT globs. Two forms only:

   "scripts/lib/agentic/worker.mjs"   exactly this file
   "scripts/lib/agentic/"             any file under this directory

 A glob language in a security-relevant allowlist is a second parser to get
 wrong, and `**` in particular reads as "narrow" to a human and matches the
 world. Listing a directory is unambiguous and is what a real task needs.
*/
export function normalizeScopeEntry(raw, field = 'scope') {
  const value = text(raw, field, { max: 300 });
  if (value.startsWith('/') || value.startsWith('~')) fail(`${field} must be repository-relative`);
  if (value.startsWith('../') || value.includes('/../') || value === '..') fail(`${field} must not traverse upward`);
  if (value.includes('*') || value.includes('?')) fail(`${field} must be a file path or a directory prefix, not a glob`);
  if (value.startsWith('./')) fail(`${field} must not start with "./"`);
  if (value.includes('//')) fail(`${field} must not contain an empty path segment`);
  return value;
}

/** True when `relativePath` is inside the approved scope of a contract. */
export function scopeAllows(scope, relativePath) {
  if (typeof relativePath !== 'string' || !relativePath || relativePath.includes('\0')) return false;
  if (relativePath.startsWith('/') || relativePath.startsWith('~')) return false;
  if (relativePath === '..' || relativePath.startsWith('../') || relativePath.includes('/../')) return false;
  return scope.some(entry => (entry.endsWith('/') ? relativePath.startsWith(entry) : relativePath === entry));
}

/**
 * Validate and canonicalize one task contract. Returns a new frozen object with
 * fields in a fixed order, so `contractDigest` is stable across serializations.
 */
export function normalizeTaskContract(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('a task must be an object');
  const id = text(raw.id, 'id', { max: 64 });
  if (!ID_PATTERN.test(id)) fail(`id "${id}" must be lowercase kebab-case, 2-64 characters`);
  if (!Number.isInteger(raw.weight) || raw.weight < 1 || raw.weight > 100) fail('weight must be an integer 1-100');
  if (raw.rev !== undefined && (!Number.isInteger(raw.rev) || raw.rev < 1)) fail('rev must be a positive integer');
  if (raw.risk !== undefined && !RISKS.includes(raw.risk)) fail(`risk must be one of ${RISKS.join(', ')}`);
  if (raw.reviewDepth !== undefined && !REVIEW_DEPTHS.includes(raw.reviewDepth)) fail(`reviewDepth must be one of ${REVIEW_DEPTHS.join(', ')}`);
  if (raw.origin !== undefined && !ORIGINS.includes(raw.origin)) fail(`origin must be one of ${ORIGINS.join(', ')}`);

  const dependencies = list(raw.dependencies, 'dependencies', { max: 50, itemMax: 64 });
  for (const dependency of dependencies) if (!ID_PATTERN.test(dependency)) fail(`dependency "${dependency}" is not a task id`);
  if (dependencies.includes(id)) fail('a task may not depend on itself');
  if (new Set(dependencies).size !== dependencies.length) fail('duplicate dependency');

  const scope = list(raw.scope, 'scope', { required: true, max: 60, itemMax: 300 })
    .map(entry => normalizeScopeEntry(entry));
  if (new Set(scope).size !== scope.length) fail('duplicate scope entry');

  const checks = list(raw.checks, 'checks', { required: true, max: 20, itemMax: 64 });
  for (const check of checks) if (!ID_PATTERN.test(check)) fail(`check "${check}" is not a registry name`);

  // Ordered explicitly; the digest depends on this order, not on insertion order.
  return Object.freeze({
    id,
    rev: raw.rev ?? 1,
    title: text(raw.title, 'title', { max: 200 }),
    objective: text(raw.objective, 'objective'),
    context: text(raw.context, 'context', { required: false }),
    brief: text(raw.brief, 'brief', { required: false, max: MAX_BRIEF }),
    weight: raw.weight,
    dependencies,
    scope,
    nonScope: list(raw.nonScope, 'nonScope', { max: 30 }),
    constraints: list(raw.constraints, 'constraints', { max: 30 }),
    preconditions: list(raw.preconditions, 'preconditions', { max: 20 }),
    acceptance: list(raw.acceptance, 'acceptance', { required: true, max: 30 }),
    checks,
    risk: raw.risk ?? 'medium',
    reviewDepth: raw.reviewDepth ?? 'standard',
    escalateWhen: list(raw.escalateWhen, 'escalateWhen', { max: 20 }),
    origin: raw.origin ?? 'plan',
    originReview: raw.originReview === undefined || raw.originReview === null
      ? null
      : text(raw.originReview, 'originReview', { max: 64 }),
  });
}

/*
 Preconditions: optional, and ENFORCEABLE where they can be (mission §5,
 corrected 2026-09-22).

 A precondition written in one of the machine-checkable forms below is verified
 before the worker takes its first turn, and the task refuses to start if it does
 not hold. Anything else is prose, and prose still reaches the worker and the
 reviewer as context — the field is not required, and a plain sentence is a
 legitimate use of it.

   exists: path/to/file        must be present in the worktree before work starts
   absent: path/to/file        must NOT be present

 The failure this prevents is the expensive one: an agent spending an attempt,
 and a reviewer spending a cycle, discovering that the ground it was standing on
 was not there. `accepted:` is deliberately absent — that is what `dependencies`
 already expresses, and two ways to say one thing is one way to disagree.
*/
const PRECONDITION = /^(exists|absent):\s*(.+)$/;

export function parsePrecondition(text) {
  const match = PRECONDITION.exec(String(text ?? '').trim());
  if (!match) return null;
  const path = match[2].trim();
  // A precondition that names an unusable path is a broken contract, not a
  // failed precondition, so it is reported as prose rather than enforced.
  if (!path || path.startsWith('/') || path.startsWith('~') || path.includes('..') || path.includes('\0')) return null;
  return { kind: match[1], path };
}

/** The fields a contract's identity depends on; runtime status is excluded. */
const DIGEST_FIELDS = ['id', 'rev', 'title', 'objective', 'context', 'weight', 'dependencies',
  'scope', 'nonScope', 'constraints', 'preconditions', 'acceptance', 'checks', 'risk',
  'reviewDepth', 'escalateWhen', 'origin', 'originReview'];

/**
 * A stable fingerprint of the contract text. A review records the digest of what
 * it examined, so an accepted review cannot later be claimed as approval of a
 * contract that was edited afterwards.
 */
export function contractDigest(contract) {
  const canonical = DIGEST_FIELDS.map(field => [field, contract[field]]);
  // The brief is part of what a review examined, so an edited brief is a
  // different contract. It is appended only when present, so every contract
  // written before briefs existed keeps the digest its reviews recorded.
  if (contract.brief) canonical.push(['brief', contract.brief]);
  return createHash('sha256').update(JSON.stringify(canonical)).digest('hex').slice(0, 32);
}

/** Validate a whole graph: unique ids, resolvable dependencies, no cycles. */
export function normalizeTaskGraph(rawTasks) {
  if (!Array.isArray(rawTasks) || !rawTasks.length || rawTasks.length > 1000) fail('a graph needs 1-1000 tasks');
  const tasks = rawTasks.map(normalizeTaskContract);
  const ids = new Set();
  for (const task of tasks) {
    if (ids.has(task.id)) fail(`duplicate task id "${task.id}"`);
    ids.add(task.id);
  }
  const byId = new Map(tasks.map(task => [task.id, task]));
  const visited = new Set(), visiting = new Set();
  const visit = id => {
    if (!ids.has(id)) fail(`dependency "${id}" names no task in the graph`);
    if (visiting.has(id)) fail(`dependency cycle through "${id}"`);
    if (visited.has(id)) return;
    visiting.add(id);
    for (const dependency of byId.get(id).dependencies) visit(dependency);
    visiting.delete(id);
    visited.add(id);
  };
  for (const id of ids) visit(id);
  return tasks;
}

/**
 * The reviewer's output schema. Parsed from model output, so it is validated
 * defensively: anything the orchestrator will ACT on must be well formed, and a
 * malformed review is a failed review, never a silently permissive one.
 */
export function normalizeReviewContract(raw, { taskId, contractDigest: digest } = {}) {
  const bad = message => { throw new Error(`invalid review contract: ${message}`); };
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) bad('a review must be an object');
  if (!VERDICTS.includes(raw.verdict)) bad(`verdict must be one of ${VERDICTS.join(', ')}`);

  const failed = (Array.isArray(raw.failed) ? raw.failed : []).slice(0, 30).map((item, index) => {
    if (!item || typeof item !== 'object') bad(`failed[${index}] must be an object`);
    if (!SEVERITIES.includes(item.severity)) bad(`failed[${index}].severity must be one of ${SEVERITIES.join(', ')}`);
    return Object.freeze({
      criterion: text(item.criterion, `failed[${index}].criterion`, { max: 500 }),
      severity: item.severity,
      evidence: text(item.evidence, `failed[${index}].evidence`, { required: false, max: 1000 }),
    });
  });

  const verdict = raw.verdict;
  // The orchestrator must never have to infer advancement from prose, and a
  // model that says PASS while listing a blocking failure has contradicted
  // itself. Resolve it here, strictly, in the safe direction.
  if (verdict === 'PASS' && failed.some(item => item.severity !== 'minor')) {
    bad('PASS cannot carry a major or blocking failure; use PASS_WITH_TASKS or BLOCKED');
  }
  if (verdict === 'BLOCKED' && !text(raw.escalationReason, 'escalationReason', { required: false, max: 1000 })) {
    bad('BLOCKED requires escalationReason');
  }

  const corrections = (Array.isArray(raw.corrections) ? raw.corrections : []).slice(0, 10);
  if (verdict === 'PASS_WITH_TASKS' && !corrections.length) {
    bad('PASS_WITH_TASKS requires at least one correction task');
  }
  if (verdict !== 'PASS_WITH_TASKS' && corrections.length) {
    bad('corrections are only permitted with PASS_WITH_TASKS');
  }

  return Object.freeze({
    taskId: text(raw.taskId ?? taskId, 'taskId', { max: 64 }),
    contractDigest: text(raw.contractDigest ?? digest, 'contractDigest', { max: 64 }),
    verdict,
    advancement: verdict !== 'BLOCKED',
    summary: text(raw.summary, 'summary', { max: 1500 }),
    examined: list(raw.examined, 'examined', { max: 60, itemMax: 300 }),
    passed: list(raw.passed, 'passed', { max: 30 }),
    failed,
    corrections,
    escalationReason: text(raw.escalationReason, 'escalationReason', { required: false, max: 1000 }),
    // An EMPTY STRING means absent, not invalid. Models fill optional string
    // fields with "" as a matter of course, and an earlier version threw on it
    // -- so a correct PASS_WITH_TASKS review was discarded over a field that
    // only matters for BLOCKED. In production that retries once, fails the same
    // way, and escalates: Nick woken to be told about a review that was right.
    // Observed on the very first live reviewer run.
    escalationKind: raw.escalationKind ? text(raw.escalationKind, 'escalationKind', { max: 64 }) : null,
  });
}
