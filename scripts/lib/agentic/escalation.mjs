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
  try { return Number(JSON.parse(await readFile(join(root, 'alerts.json'), 'utf8')).lastAttemptAt ?? 0); }
  catch { return 0; }
}

async function recordAlert(root, escalationId, delivered) {
  let current = {};
  try { current = JSON.parse(await readFile(join(root, 'alerts.json'), 'utf8')); } catch {}
  await writeFile(join(root, 'alerts.json'),
    JSON.stringify({ ...current, lastAttemptAt: Date.now(),
      ...(delivered ? { lastAt: Date.now(), lastEscalation: escalationId } : {}) }), { mode: 0o600 });
}

/** Write the full Astra brief beside the run state and return its path. */
export async function writeAstraBrief(state, { root, worktree, baseRef, project, escalation }) {
  const directory = join(root, 'briefs');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const suffix = String(escalation?.id ?? 'run').replace(/[^a-zA-Z0-9_-]/g, '-');
  const path = join(directory, `astra-${suffix}.md`);
  await writeFile(path, await astraBrief(state, { root, worktree, baseRef, project, escalation }), { mode: 0o600 });
  return path;
}

export async function sendDiscordAlert(message, { timeoutMs = 30_000, silent = false } = {}) {
  // The alert CLI caps UTF-8 bytes, not JavaScript characters. Keep a useful
  // compact alert deliverable even when a review contains a long failure list.
  if (Buffer.byteLength(message, 'utf8') > 1500) {
    let brief = '';
    for (const char of message) {
      if (Buffer.byteLength(brief + char, 'utf8') > 1440) break;
      brief += char;
    }
    message = brief + '\n[Full details: agent status / local run brief]';
  }
  try {
    await run(ALERT_CLI, [message], {
      timeout: timeoutMs,
      env: { PATH: '/usr/bin:/bin:/usr/local/bin:/opt/homebrew/bin', HOME: process.env.HOME ?? '',
        // Delivered to the channel, but without a push notification: the message
        // is there in the morning and nothing buzzed at 03:00.
        ...(silent ? { ORION_DISCORD_SILENT: '1' } : {}) },
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
export async function notifyEscalation(state, { root, worktree, baseRef, repoRoot, project = 'ORION', force = false,
  digest = false, silent = false } = {}) {
  const pending = (state.escalations ?? []).filter(item => !item.resolvedAt && !item.notified);
  if (!pending.length) return { attempted: false, delivered: false, reason: 'nothing to notify', results: [] };
  if (digest) return notifyRunDigest(state, { root, worktree, baseRef, project, pending, silent });
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
    // `root` is what lets the message name THIS project's commands (with
    // --project); without it every alert printed the legacy form, which answers
    // "No project-agent run exists" for a project run. The brief path goes in
    // through the builder so it sits inside the byte budget instead of being
    // appended past it and cut off.
    const message = discordBrief(state, { project, escalation, journal, root, briefPath, repoRoot });
    const sent = await sendDiscordAlert(message);
    await recordAlert(root, escalation.id, sent.delivered).catch(() => {});
    results.push({ id: escalation.id, delivered: sent.delivered, reason: sent.reason, briefPath, message });
  }
  return { attempted: true, delivered: results.some(r => r.delivered), results,
    reason: results.map(r => r.reason).filter(Boolean).join('; ') || null };
}

/*
 THE END-OF-RUN DIGEST.

 When the run can go no further, everything that is open goes out as ONE
 message: what was accepted, what was deferred and why, and where the Astra
 packet is. Deferrals held back in quiet mode arrive here, not one by one. Every
 escalation it covers is reported with the digest's delivery result, so a
 digest that failed to send is retried as a digest, never as a burst.
*/
export function runDigest(state, { project = 'ORION', packetPath = null } = {}) {
  const open = (state.escalations ?? []).filter(item => !item.resolvedAt);
  const accepted = state.tasks.filter(task => task.status === 'accepted').length;
  const deferred = open.filter(item => item.taskId !== null);
  const stops = open.filter(item => item.taskId === null);
  const deferredIds = new Set(deferred.map(item => item.taskId));
  // Tasks that never ran because something they depend on is deferred.
  const waiting = state.tasks.filter(task => task.status === 'queued' && !deferredIds.has(task.id) &&
    task.dependencies.some(id => state.tasks.find(item => item.id === id)?.status !== 'accepted'));
  const clip = (text, n) => String(text ?? '').replace(/\s+/g, ' ').slice(0, n);
  return [
    `ORION · ${project} run stopped · ${accepted}/${state.tasks.length} tasks accepted`,
    ...stops.map(item => `Stopped: ${clip(item.reason, 300)}`),
    deferred.length ? `Deferred for Astra (${deferred.length}):` : '',
    ...deferred.map(item => `• ${item.taskId} — ${clip(item.reason, 220)}`),
    waiting.length ? `Waiting on a deferred task: ${waiting.map(task => task.id).join(', ')}` : '',
    packetPath ? `Astra packet: ${packetPath}` : '',
  ].filter(Boolean).join('\n');
}

async function notifyRunDigest(state, { root, worktree, baseRef, project, pending, silent }) {
  const open = (state.escalations ?? []).filter(item => !item.resolvedAt);
  const briefs = [];
  for (const escalation of open) {
    const path = await writeAstraBrief(state, { root, worktree, baseRef, project, escalation }).catch(() => null);
    briefs.push({ escalation, path });
  }
  const packetPath = join(root, 'briefs', 'astra-deferred.md');
  const packet = [
    `# Astra packet — ${project}`, '',
    `Written ${new Date().toISOString()}. ${state.tasks.filter(task => task.status === 'accepted').length}/${state.tasks.length} tasks accepted.`,
    'Each entry below was deferred by the local loop after its bounded ladder was spent. Its full brief is linked.', '',
    ...briefs.map(({ escalation, path }) =>
      `- **${escalation.taskId ?? 'run'}** (${escalation.kind}): ${escalation.reason}${path ? `\n  Brief: ${path}` : ''}`),
    '',
  ].join('\n');
  const wrote = await mkdir(join(root, 'briefs'), { recursive: true, mode: 0o700 })
    .then(() => writeFile(packetPath, packet, { mode: 0o600 })).then(() => true).catch(() => false);
  const message = runDigest(state, { project, packetPath: wrote ? packetPath : null });
  const sent = await sendDiscordAlert(message, { silent });
  await recordAlert(root, 'digest', sent.delivered).catch(() => {});
  return { attempted: true, delivered: sent.delivered, reason: sent.reason, message, packetPath: wrote ? packetPath : null,
    results: pending.map(item => ({ id: item.id, delivered: sent.delivered, reason: sent.reason })) };
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
 * One short line telling Nick the worker got stuck and what is happening about
 * it. Informational, like a repair: the loop has NOT stopped, the reviewer is
 * being brought in, and nothing is being asked of him. If it arrived looking
 * like an escalation it would teach the channel to cry wolf, and the next real
 * 01:00 stop would be the one he sleeps through.
 */
export async function notifyWorkerStuck(root, { project = 'ORION', taskId, title, attempts, blocker }) {
  const since = await lastInfoAt(root);
  if (Date.now() - since < INFO_INTERVAL_MS) {
    return { attempted: false, delivered: false, reason: 'informational rate limit' };
  }
  // Two different situations, and the line should say which: a worker that is
  // busy getting nowhere, and one that ran out of time. Both are handed up to
  // the reviewer; neither is asking anything of Nick.
  const timedOut = blocker === 'worker_timeout';
  const message = [
    timedOut ? `ORION · the worker ran out of time on ${taskId}` : `ORION · the worker is stuck on ${taskId}`,
    title ? `Task: ${String(title).slice(0, 200)}` : '',
    timedOut
      ? `It hit the per-task time limit on attempt ${attempts}. It stopped cleanly and its partial work was kept.`
      : `It kept working without writing anything new or fixing a check (attempt ${attempts}, ${blocker}).`,
    'The review model is now trying to break it out. No action needed — you will hear again only if that fails.',
  ].filter(Boolean).join('\n');

  const sent = await sendDiscordAlert(message);
  if (sent.delivered) await recordInfo(root).catch(() => {});
  return { attempted: true, ...sent, message };
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


/** One notification per durable recovery claim; no error text sent externally. */
export async function notifyRuntimeRecovery(root, { phase, id }) {
  return sendDiscordAlert(`ORION · runtime issue during ${phase}. The reviewer is attempting bounded recovery and will resume if it can. Recovery ${id.slice(0, 8)}. You will receive a separate alert if the run needs you.`);
}
