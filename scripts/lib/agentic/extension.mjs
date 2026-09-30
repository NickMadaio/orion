/*
 More time for a task that is getting somewhere.

 The task hour used to be a wall. On the live run (2026-09-25) a worker that was
 making steady progress hit it, was handed to the reviewer as "timed out", and
 the night stopped. An hour is a fine first budget and a bad verdict.

 So the hour is SOFT. When the next exchange will not fit in the time left, the
 host asks one question first, deterministically: has this attempt made real
 progress recently (a new file, a check turning green, a correction made at a
 self-review)? If not, no time is given — that is the stuck gate's case, and
 the reviewer rung handles it. If so, the reviewer reads a short progress
 report and grants time (and exchanges) with an ETA. It can grant nothing.

 Every grant is bounded: per grant, and by a hard ceiling on the task that no
 grant can pass. The reviewer judges how much; the host decides whether it may
 be asked, and owns the ceiling.
*/
import { cancellableGenerate } from './cancellation.mjs';
import { parseJsonBlock } from './prompts.mjs';

/** Exchanges without progress after which no extension is even considered. */
export const RECENT_WINDOW = 4;

const minutes = ms => Math.round(ms / 60_000);

/** Did this attempt make progress in its last few exchanges? Pure. */
export function recentProgress({ turn, progressTurns, window = RECENT_WINDOW }) {
  return progressTurns.some(at => at > turn - 1 - window && at <= turn - 1);
}

function report({ task, turn, exchanges, progressTurns, checkResults, elapsedMs, grantedMs, hardRemainingMs }) {
  const rows = exchanges.slice(-8).map(item =>
    `- exchange ${item.turn}: ${Math.round(item.ms / 1000)}s, ${item.actions.join(' ') || 'nothing usable'}` +
    `${progressTurns.includes(item.turn) ? ' — PROGRESS' : ''}`);
  const passing = checkResults.filter(result => result.ok).length;
  const failing = checkResults.filter(result => !result.ok);
  return [
    `## Task ${task.id}: ${task.title}`,
    `Objective: ${String(task.objective ?? '').slice(0, 600)}`,
    `Acceptance criteria: ${(task.acceptance ?? []).length}`,
    `## Time`,
    `${minutes(elapsedMs)} min used on this attempt, ${minutes(grantedMs)} min already granted beyond the first budget, ` +
      `${minutes(hardRemainingMs)} min left before the hard ceiling.`,
    `## Exchanges (next is ${turn})`,
    ...rows,
    `## Checks now`,
    checkResults.length
      ? `${passing}/${checkResults.length} passing.` + (failing.length
        ? `\nFailing:\n${failing.map(result => `- ${result.name}: ${String(result.output ?? '').slice(-500)}`).join('\n')}` : '')
      : 'Not run yet this attempt.',
  ].join('\n');
}

const SYSTEM = 'You supervise a local coding worker that is running out of its time budget. ' +
  'Decide how much more time it should get, from the evidence only. Grant time when the work is ' +
  'converging (checks improving, failures narrowing, files taking shape); grant little or none ' +
  'when it is circling. Reply with one fenced JSON block and nothing else: ' +
  '{"extendMinutes": <integer 0-MAX>, "etaMinutes": <integer, your estimate to a verified finish>, ' +
  '"reason": "<one sentence>"}';

/**
 * Decide an extension. Never throws for a model failure: a reviewer that cannot
 * answer falls back to the host's default grant, because the host has already
 * established that the work is progressing.
 */
export async function decideExtension({ runtime, task, turn, exchanges, progressTurns, checkResults,
  elapsedMs, grantedMs, hardRemainingMs, maxGrantMs, defaultGrantMs, signal }) {
  const cap = Math.max(0, Math.min(maxGrantMs, hardRemainingMs));
  if (cap < 60_000) return { grantMs: 0, by: 'host', reason: 'the hard ceiling for this task has been reached' };
  if (!recentProgress({ turn, progressTurns })) {
    return { grantMs: 0, by: 'host', reason: `no progress in the last ${RECENT_WINDOW} exchanges` };
  }
  const fallback = reason => ({ grantMs: Math.min(defaultGrantMs, cap), by: 'host', reason, etaMinutes: null });
  let response;
  try {
    response = await cancellableGenerate(runtime, 'reviewer', {
      system: SYSTEM.replace('MAX', String(minutes(cap))),
      prompt: report({ task, turn, exchanges, progressTurns, checkResults, elapsedMs, grantedMs, hardRemainingMs }),
      think: false, signal,
    });
  } catch (error) {
    signal?.throwIfAborted();
    return fallback(`the reviewer could not be asked (${String(error?.message ?? error).slice(0, 120)}); progress is recent`);
  }
  const verdict = parseJsonBlock(response.text);
  const asked = Number(verdict?.extendMinutes);
  if (!Number.isFinite(asked) || asked < 0) return fallback('the reviewer gave no usable answer; progress is recent');
  const eta = Number(verdict?.etaMinutes);
  return {
    grantMs: Math.min(cap, Math.round(asked) * 60_000),
    by: 'reviewer',
    etaMinutes: Number.isFinite(eta) && eta >= 0 ? Math.round(eta) : null,
    reason: String(verdict?.reason ?? '').slice(0, 300) || 'no reason given',
  };
}
