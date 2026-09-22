/*
 Telling Nick, and only when it is worth telling him.

 THE TWO FAILURES, WHICH ARE OPPOSITES

   Silence:  a run blocks at 01:00 and waits until it is discovered at 09:00.
             Eight hours of unattended capacity thrown away. This is the failure
             the whole escalation path exists to prevent.

   Noise:    an alert for something the local loop could have handled. The
             channel gets muted, and a muted channel turns every future
             escalation back into the first failure. Crying wolf is not a
             smaller mistake than silence; it is the same mistake with a delay.

 So: exactly one alert per escalation, a floor on how often any alert may be
 sent, and nothing sent at all for conditions the loop resolves itself. Retries,
 failed checks, correction cycles and refused writes are ordinary; they are
 journalled and never notified.

 DELIVERY IS BEST-EFFORT AND HONEST ABOUT IT

 `scripts/orion-discord-alert` is the existing, opt-in, `.env`-gated route; this
 module does not learn a second way to reach Discord and never handles the
 webhook. If the alert cannot be delivered, the escalation still stands and the
 state still says `notified: false` — so the morning's first `status` shows both
 that the run stopped and that nobody was told.
*/
import { execFile } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { astraBrief, discordBrief } from './brief.mjs';
import { readJournal } from './journal.mjs';

const run = promisify(execFile);
const ALERT_CLI = join(import.meta.dirname, '../../orion-discord-alert');
const MIN_INTERVAL_MS = 10 * 60 * 1000;

/** Conditions the local loop handles by itself. Never notified. */
export const SELF_HANDLED = Object.freeze([
  'check_failed', 'worker_retry', 'changes_requested', 'write_refused',
  'unusable_reply', 'correction_cycle', 'reviewer_rejected',
]);

async function lastAlertAt(root) {
  try { return Number(JSON.parse(await readFile(join(root, 'alerts.json'), 'utf8')).lastAt ?? 0); }
  catch { return 0; }
}

async function recordAlert(root, escalationId) {
  await writeFile(join(root, 'alerts.json'),
    JSON.stringify({ lastAt: Date.now(), lastEscalation: escalationId }), { mode: 0o600 });
}

/** Write the full Astra brief beside the run state and return its path. */
export async function writeAstraBrief(state, { root, worktree, baseRef, project, escalation }) {
  const directory = join(root, 'briefs');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `astra-${new Date().toISOString().replace(/[:.]/g, '-')}.md`);
  await writeFile(path, await astraBrief(state, { root, worktree, baseRef, project, escalation }), { mode: 0o600 });
  return path;
}

export async function sendDiscordAlert(message, { timeoutMs = 30_000 } = {}) {
  try {
    await run(ALERT_CLI, [message], {
      timeout: timeoutMs,
      env: { PATH: '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin', HOME: process.env.HOME ?? '' },
    });
    return { delivered: true, reason: null };
  } catch (error) {
    return { delivered: false, reason: String(error.stderr || error.message || error).slice(0, 300) };
  }
}

/**
 * Notify about every open escalation that has not been reported yet.
 *
 * Returns one result per escalation. The caller records `notified` in durable
 * state only for the ones that were delivered, so a failed alert is retried on
 * the next pass rather than forgotten.
 */
export async function notifyEscalation(state, { root, worktree, baseRef, project = 'ORION', force = false } = {}) {
  const pending = (state.escalations ?? []).filter(item => !item.resolvedAt && (!item.notified || force));
  if (!pending.length) return { attempted: false, delivered: false, reason: 'nothing to notify', results: [] };
  if (!force) {
    const since = await lastAlertAt(root);
    if (Date.now() - since < MIN_INTERVAL_MS) {
      return { attempted: false, delivered: false, results: [],
        reason: `rate limited; last alert was ${Math.round((Date.now() - since) / 60000)} minutes ago` };
    }
  }

  const results = [];
  for (const escalation of pending) {
    if (SELF_HANDLED.includes(escalation.kind)) {
      results.push({ id: escalation.id, delivered: false, reason: `"${escalation.kind}" is handled locally`, briefPath: null });
      continue;
    }
    const briefPath = await writeAstraBrief(state, { root, worktree, baseRef, project, escalation }).catch(() => null);
    const journal = await readJournal(root, { limit: 2000 });
    const message = `${discordBrief(state, { project, escalation, journal })}${briefPath ? `\nBrief: ${briefPath}` : ''}`;
    const sent = await sendDiscordAlert(message);
    if (sent.delivered) await recordAlert(root, escalation.id).catch(() => {});
    results.push({ id: escalation.id, delivered: sent.delivered, reason: sent.reason, briefPath, message });
  }
  return { attempted: true, delivered: results.some(r => r.delivered), results,
    reason: results.map(r => r.reason).filter(Boolean).join('; ') || null };
}

/*
 The INFORMATIONAL tier.

 Nick asked for a message when the reviewer steps in to repair -- "just to
 inform me, nothing crazy". That is deliberately not an escalation: nothing is
 blocked, nobody needs to get up, and routing it through the escalation path
 would teach the alert channel to cry wolf.

 So it is its own tier with its own rate limit, one line, no brief, and no
 action requested. If the two tiers ever have to be told apart at 3am, the
 escalation tier is the one that asks for something.
*/
const INFO_INTERVAL_MS = 30 * 60 * 1000;

async function lastInfoAt(root) {
  try { return Number(JSON.parse(await readFile(join(root, 'alerts.json'), 'utf8')).lastInfoAt ?? 0); }
  catch { return 0; }
}

async function recordInfo(root) {
  let current = {};
  try { current = JSON.parse(await readFile(join(root, 'alerts.json'), 'utf8')); } catch { /* first one */ }
  await writeFile(join(root, 'alerts.json'), JSON.stringify({ ...current, lastInfoAt: Date.now() }), { mode: 0o600 });
}

/**
 * One short line telling Nick the reviewer wrote code. Never asks for anything.
 */
export async function notifyReviewerRepair(root, { project = 'ORION', taskId, model, files, diagnosis, improved, commit }) {
  const since = await lastInfoAt(root);
  if (Date.now() - since < INFO_INTERVAL_MS) {
    return { attempted: false, delivered: false, reason: 'informational rate limit' };
  }
  const message = [
    `ORION · reviewer stepped in on ${taskId}`,
    `The worker was stuck, so ${model} made a bounded repair to ${files.length} file(s): ${files.join(', ')}.`,
    diagnosis ? `Why: ${String(diagnosis).slice(0, 300)}` : '',
    improved ? 'Checks pass; the worker is continuing.' : 'Checks still failing — this may escalate.',
    commit ? `Commit ${String(commit).slice(0, 10)} (recorded separately from reviews).` : '',
    'No action needed.',
  ].filter(Boolean).join('\n');

  const sent = await sendDiscordAlert(message);
  if (sent.delivered) await recordInfo(root).catch(() => {});
  return { attempted: true, ...sent, message };
}
