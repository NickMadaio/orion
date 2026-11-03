// The workout ORION asked a follow-up about and is waiting for an answer to (orion-workout-log).
//
// CONTRACT: <controlled dir>/workout-pending.json = { id, at: ISO, expiresAt: ISO, asked: 1|2, text, draft, missing, question }
// One slot (a chat has one workout in the air at a time; a new description replaces it). The plugin (workout-chat.ts) reads it to
// bind a short reply; `orion-workout-log answer "<words>"`, `discard` and the log clear it. Tmp file and rename, never half a file.
// Never written during an evaluation (eval-mode marker): the question is asked, nothing is kept, so a gate leaves nothing behind.
import { readFileSync, renameSync, unlinkSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { controlledDir } from "../clock.mjs";
import { evalMode } from "../eval-mode.mjs";

export const PENDING_FILE = "workout-pending.json";
export const PENDING_MS = 30 * 60_000;
export const pendingPath = (env = process.env) => join(controlledDir(env), PENDING_FILE);

/** The live waiting workout, or null. */
export function readWorkoutPending({ now = new Date(), env = process.env } = {}) {
  try {
    const row = JSON.parse(readFileSync(pendingPath(env), "utf8"));
    return row?.draft && Date.parse(row.expiresAt) > now.getTime() ? row : null;
  } catch { return null; }
}

/** Keeps a workout waiting on an answer; `saved: false` during an evaluation (nothing written). */
export function writeWorkoutPending(row, { now = new Date(), env = process.env } = {}) {
  const kept = { id: row.id ?? `wp-${randomUUID().slice(0, 8)}`, ...row, at: now.toISOString(), expiresAt: new Date(now.getTime() + PENDING_MS).toISOString() };
  if (evalMode()) return { ...kept, saved: false };
  mkdirSync(controlledDir(env), { recursive: true });
  const tmp = `${pendingPath(env)}.${randomUUID().slice(0, 8)}.tmp`;
  writeFileSync(tmp, JSON.stringify(kept, null, 2), { mode: 0o600 });
  renameSync(tmp, pendingPath(env));
  return kept;
}

export function clearWorkoutPending({ env = process.env } = {}) {
  if (evalMode()) return;
  try { unlinkSync(pendingPath(env)); } catch { /* none */ }
}
