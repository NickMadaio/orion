// Evaluation mode (2026-09-30). A scenario run asked "do I need an umbrella?",
// ORION ran orion-weather-alert, and a real message reached Nick's Discord.
// While ~/.openclaw/orion-controlled/eval-mode exists (and is under two hours
// old, so a forgotten marker cannot silence ORION for good), every script that
// sends something to a person reports "not sent" instead of sending.
import { statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const EVAL_MARKER = process.env.ORION_EVAL_MARKER || join(homedir(), ".openclaw/orion-controlled/eval-mode");

export function evalMode(now = Date.now()) {
  try { return now - statSync(EVAL_MARKER).mtimeMs < 2 * 3600_000; } catch { return false; }
}

/** Call first in a sender: exits 0 with a plain "not sent" line during an evaluation. */
export function refuseDuringEval(what) {
  if (!evalMode()) return;
  console.log(`Not sent: ${what} — ORION is in an evaluation run, so nothing goes out to anyone.`);
  process.exit(0);
}
