/*
 The reviewer adapter: the stronger local model's review and bounded repair.

 IT REVIEWS AGAINST THE CONTRACT, AND THE PARSER ENFORCES THAT IT MEANT IT

 A review whose verdict has to be inferred from prose is a review the
 orchestrator cannot act on. So the model returns JSON, and `normalizeReviewContract`
 rejects the self-contradictory shapes rather than resolving them charitably:
 PASS carrying a blocking failure, PASS_WITH_TASKS carrying no correction,
 BLOCKED carrying no reason. A malformed review is a FAILED review — it is
 retried, and if it keeps failing that is an escalation, never a quiet accept.

 REPAIR IS A RECORDED EXCEPTION

 When the worker has spent its attempts on the same problem, the reviewer may
 make a small targeted correction. Every file it writes is recorded in
 `state.repairs`, separately from `state.reviews`, because Astra needs to see at
 a glance where the reviewer stopped reviewing and started implementing. The
 scope enforced on a repair is the WORKER'S task scope: a reviewer cannot grant
 itself reach the task never had.
*/
import { normalizeReviewContract, contractDigest, normalizeTaskContract } from './contract.mjs';
import { runChecks, describeChecks } from './checks.mjs';
import { parseJsonBlock, parseWorkerReply, repairTurn, reviewerTurn, systemPrompt } from './prompts.mjs';
import { changedFiles, commitCheckpoint, diffSince, readScoped, snapshotBaseline, writeScoped } from './workspace.mjs';

const MAX_REVIEW_ATTEMPTS = 2;
const MAX_REPAIR_FILES = 6;

export class ReviewUnusable extends Error {
  constructor(message, detail) { super(message); this.name = 'ReviewUnusable'; this.detail = detail; }
}

/**
 * Review one checkpoint against its contract. Returns a normalized review
 * contract; throws `ReviewUnusable` when the model could not produce one.
 */
export async function reviewCheckpoint({ runtime, worktree, task, baseRef, checkResults, workerSummary, priorFindings = [], emit = () => {}, signal }) {
  const system = await systemPrompt('reviewer-system');
  const diff = await diffSince(worktree, baseRef, { paths: [] });
  const prompt = reviewerTurn({
    contract: task, diff, checkResults, workerSummary,
    attempts: task.attempts, priorFindings, checkDescriptions: describeChecks(task.checks),
  });

  let lastError = null;
  for (let attempt = 1; attempt <= MAX_REVIEW_ATTEMPTS; attempt++) {
    const response = await runtime.generate('reviewer', {
      system,
      prompt: lastError
        ? `${prompt}\n\n## YOUR PREVIOUS REPLY WAS REJECTED\n${lastError}\nReturn one fenced JSON block that satisfies the rules exactly.`
        : prompt,
      signal,
    });
    emit({ kind: 'reviewer_turn', taskId: task.id, data: {
      attempt, ms: response.ms, model: response.model, evicted: response.handoff.evicted,
      doneReason: response.meta.doneReason, thinkingChars: response.meta.thinkingChars,
    } });

    const raw = parseJsonBlock(response.text);
    if (!raw) { lastError = 'No fenced JSON block was found in your reply.'; continue; }
    try {
      const review = normalizeReviewContract(raw, {
        taskId: task.id,
        contractDigest: contractDigest(normalizeTaskContract(task)),
      });
      // The model does not get to review a different task than the one it was
      // given, even by accident.
      if (review.taskId !== task.id) { lastError = `Your review names task "${review.taskId}"; this review is for "${task.id}".`; continue; }
      return { review, model: response.model, ms: response.ms, diffTruncated: diff.truncated };
    } catch (error) {
      lastError = String(error.message ?? error);
      emit({ kind: 'reviewer_rejected', taskId: task.id, data: { attempt, reason: lastError } });
    }
  }
  throw new ReviewUnusable(`the reviewer did not produce a usable review after ${MAX_REVIEW_ATTEMPTS} attempts`, { lastError });
}

/**
 * Bounded reviewer repair. Diagnose, make the minimum useful correction,
 * validate, hand back. Returns what it changed so the caller can record it
 * separately from the review.
 */
export async function repairCheckpoint({ runtime, worktree, task, baseRef, checkResults, history, emit = () => {}, signal }) {
  const system = await systemPrompt('reviewer-repair');
  const diff = await diffSince(worktree, baseRef);
  const files = [];
  for (const entry of task.scope) {
    if (entry.endsWith('/') || files.length >= 6) continue;
    try { files.push({ path: entry, contents: await readScoped(worktree, entry, { maxBytes: 90_000 }) }); } catch { /* may not exist */ }
  }
  const baseline = await snapshotBaseline(worktree, task.scope.filter(entry => !entry.endsWith('/')));

  const response = await runtime.generate('reviewer', {
    system,
    prompt: repairTurn({ contract: task, diff, checkResults, files, history, checkDescriptions: describeChecks(task.checks) }),
    signal,
  });
  emit({ kind: 'repair_turn', taskId: task.id, data: { ms: response.ms, model: response.model, doneReason: response.meta.doneReason } });

  const verdict = parseJsonBlock(response.text) ?? {};
  if (verdict.escalate && typeof verdict.escalate === 'object') {
    return { repaired: false, escalate: {
      kind: String(verdict.escalate.kind ?? 'architecture').slice(0, 64),
      reason: String(verdict.escalate.reason ?? verdict.diagnosis ?? 'reviewer declined to repair').slice(0, 1000),
    }, model: response.model };
  }

  const writes = parseWorkerReply(response.text).filter(action => action.kind === 'FILE');
  if (!writes.length) {
    return { repaired: false, escalate: { kind: 'judgement', reason: 'the reviewer neither repaired anything nor explained why it could not' }, model: response.model };
  }
  if (writes.length > MAX_REPAIR_FILES) {
    // "Minimum useful correction" is the contract. A reviewer rewriting the
    // world is making a design decision, and design decisions escalate.
    return { repaired: false, escalate: { kind: 'architecture', reason: `the reviewer proposed changing ${writes.length} files; a bounded repair is at most ${MAX_REPAIR_FILES}` }, model: response.model };
  }

  const written = [];
  const refusals = [];
  for (const write of writes) {
    try { written.push(await writeScoped(worktree, task, write.path, write.contents)); }
    catch (error) { refusals.push(`${write.path}: ${error.message}`); }
  }
  if (!written.length) {
    return { repaired: false, escalate: { kind: 'architecture', reason: `every repair the reviewer proposed was outside the task's approved scope: ${refusals.join('; ')}` }, model: response.model };
  }

  const dirty = (await changedFiles(worktree)).map(file => file.path);
  const results = await runChecks(task.checks, { worktree, changedFiles: dirty, baseline, signal });
  const failing = results.filter(result => !result.ok);
  emit({ kind: 'repair_checks', taskId: task.id, data: { files: written, results: results.map(item => ({ name: item.name, ok: item.ok })) } });

  return {
    repaired: true,
    files: written,
    refusals,
    checks: results,
    // A repair that does not make things better is not a repair. It is left in
    // the worktree for the worker's next attempt to see, and reported honestly
    // rather than described as a fix.
    improved: !failing.length,
    diagnosis: String(verdict.diagnosis ?? '').slice(0, 1000) || 'the reviewer supplied no diagnosis',
    rationale: String(verdict.rationale ?? '').slice(0, 1000),
    remaining: String(verdict.remaining ?? '').slice(0, 1000),
    model: response.model,
    commit: null,
  };
}

/** Commit a successful repair, so the intervention is a distinct, reversible checkpoint. */
export async function commitRepair(worktree, task, repair) {
  if (!repair.repaired || !repair.files.length) return { committed: false, commit: null, reason: 'nothing to commit' };
  return commitCheckpoint(worktree, {
    paths: repair.files,
    message: `agent-repair(${task.id}): reviewer intervention\n\n${repair.diagnosis}\n\n${repair.rationale}\n\n` +
      `Authored by the REVIEW model (${repair.model}), not the worker. Recorded in state.repairs.`,
    author: 'Orion local reviewer <orion-reviewer@localhost>',
  });
}

/**
 * The final review: the whole run, against the whole plan. Deliberately not the
 * same call as a task review — it answers a different question ("is this body of
 * work coherent") and reuses the per-task verdicts as evidence rather than
 * re-deriving them.
 */
export async function reviewRun({ runtime, worktree, baseRef, tasks, reviews, emit = () => {}, signal }) {
  const system = await systemPrompt('reviewer-system');
  const diff = await diffSince(worktree, baseRef, { maxChars: 90_000 });
  const prompt = [
    '## FINAL REVIEW OF A COMPLETED RUN',
    'Every task below was individually reviewed and accepted. Your question now is different:',
    'do these changes hold together as one coherent body of work, and is anything missing,',
    'contradictory or left half-done ACROSS tasks? Do not re-litigate accepted per-task decisions.',
    `\n## TASKS\n${tasks.map(task => `- ${task.id} (${task.origin}): ${task.title} — ${task.objective}`).join('\n')}`,
    `\n## PER-TASK VERDICTS\n${reviews.map(review => `- ${review.taskId}: ${review.decision} — ${review.summary || '(no summary)'}`).join('\n')}`,
    `\n## COMBINED DIFF\n\`\`\`diff\n${diff.stat}\n\n${diff.patch}\n\`\`\``,
    '\n## YOUR TURN\nReply with reasoning, then one fenced JSON block. Use PASS if the run is coherent,',
    'PASS_WITH_TASKS if cross-cutting corrections remain, BLOCKED if it needs Nick or Astra.',
    'Set "taskId" to "final-review".',
  ].join('\n');

  const response = await runtime.generate('reviewer', { system, prompt, signal });
  emit({ kind: 'final_review_turn', data: { ms: response.ms, model: response.model } });
  const raw = parseJsonBlock(response.text);
  if (!raw) throw new ReviewUnusable('the final review produced no usable JSON', {});
  const review = normalizeReviewContract({ ...raw, taskId: 'final-review', contractDigest: 'final-review' });
  return { review, model: response.model };
}
