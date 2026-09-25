/*
 Cancelling a running action from the phone (Phase 46: "supports mobile
 cancellation").

 The plugin runs inside the gateway; the phone reaches the Mac through
 orion-remote (Discord today, the phone app once its link lands). They share a
 directory beside the task ledger:

   actions/running/<taskId>.json   written when a run starts, removed when it ends
   actions/cancel/<taskId>         written by orion-remote on `action cancel <taskId>`

 The controller checks for the cancel mark before EVERY step. It never kills a
 step halfway: the step in flight finishes, because a half-done move, write or
 rebuild is worse than one more finished step -- the repair engine's own
 comment names killing it halfway as the one state it exists to avoid. So a
 cancel stops everything that has not started, and says so.
*/
import { existsSync } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const TASK_ID = /^orion-[a-f0-9]{16}$/;

export function actionsDirectory(ledgerPath: string): string {
  return path.join(path.dirname(ledgerPath), "actions");
}

export async function markRunning(
  ledgerPath: string,
  entry: { taskId: string; goal: string; actions: string[]; startedAt: string; commands?: string[] },
): Promise<void> {
  const directory = path.join(actionsDirectory(ledgerPath), "running");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  await writeFile(path.join(directory, `${entry.taskId}.json`), JSON.stringify(entry), { mode: 0o600 });
}

export function cancelRequested(ledgerPath: string, taskId: string): boolean {
  return TASK_ID.test(taskId) && existsSync(path.join(actionsDirectory(ledgerPath), "cancel", taskId));
}

export async function clearRun(ledgerPath: string, taskId: string): Promise<void> {
  const root = actionsDirectory(ledgerPath);
  await rm(path.join(root, "running", `${taskId}.json`), { force: true });
  await rm(path.join(root, "cancel", taskId), { force: true });
}
