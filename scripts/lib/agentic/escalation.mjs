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
 * Notify about an escalation exactly once.
 *
 * Returns `{ attempted, delivered, reason, briefPath, message }`. The caller
 * records `notified` in durable state only when `delivered` is true, so a failed
 * alert is retried on the next supervisor pass instead of being forgotten.
 */
export async function notifyEscalation(state, { root, worktree, baseRef, project = 'ORION', force = false } = {}) {
  const escalation = state.escalation;
  if (!escalation) return { attempted: false, delivered: false, reason: 'no escalation', briefPath: null, message: null };
  if (escalation.notified && !force) return { attempted: false, delivered: true, reason: 'already notified', briefPath: null, message: null };
  if (SELF_HANDLED.includes(escalation.kind)) {
    return { attempted: false, delivered: false, reason: `"${escalation.kind}" is handled locally and is not notified`, briefPath: null, message: null };
  }

  const since = await lastAlertAt(root);
  if (!force && Date.now() - since < MIN_INTERVAL_MS) {
    return { attempted: false, delivered: false, reason: `rate limited; last alert was ${Math.round((Date.now() - since) / 60000)} minutes ago`, briefPath: null, message: null };
  }

  const briefPath = await writeAstraBrief(state, { root, worktree, baseRef, project, escalation }).catch(() => null);
  const journal = await readJournal(root, { limit: 2000 });
  const message = `${discordBrief(state, { project, escalation, journal })}${briefPath ? `\nBrief: ${briefPath}` : ''}`;
  const result = await sendDiscordAlert(message);
  if (result.delivered) await recordAlert(root, escalation.id).catch(() => {});
  return { attempted: true, ...result, briefPath, message };
}
