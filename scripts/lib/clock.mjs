// One clock and one state directory for every time-driven script (2026-10-30).
//
//   ORION_NOW=<ISO>              the time every script and lib believes it is (orion-quick, orion-phone-time,
//                                orion-proactive, orion-checkin, orion-watch, orion-now, orion-reach...). Older
//                                per-script seams (ORION_REACH_NOW, ORION_CHECKIN_NOW, ORION_RESCHEDULE_NOW) still work
//                                and win when set, because a test that pins one script's clock pins it on purpose.
//   ORION_CONTROLLED_DIR=<dir>   the state directory. When it names anything other than the live
//                                ~/.openclaw/orion-controlled the run is ISOLATED: nothing may leave the machine or
//                                touch Nick's apps. Every outward path (phone push, the Mac app and its voice, Discord,
//                                lights, calendar and reminder writes) appends to <dir>/isolated-outbox.jsonl instead.
//
// A seam a test names explicitly (ORION_REACH_OPEN_BIN, ORION_BRIDGE_BIN, ORION_DISCORD_ALERT_BIN...) is a stand-in
// executable, not the outside world, so it still runs: isolation replaces only the REAL outward binaries.
import { appendFileSync, mkdirSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

export const OUTBOX_FILE = "isolated-outbox.jsonl";

/** The live state directory, for this HOME. */
export const liveDir = () => join(homedir(), ".openclaw/orion-controlled");

/** The state directory every script reads and writes. */
export const controlledDir = (env = process.env) => env.ORION_CONTROLLED_DIR || liveDir();

const real = (p) => { try { return realpathSync(p); } catch { return resolve(p); } };

/** True when ORION_CONTROLLED_DIR points somewhere other than the live directory: a test or a state copy. */
export function isolated(env = process.env) {
  const dir = env.ORION_CONTROLLED_DIR;
  return !!dir && real(dir) !== real(liveDir());
}

/**
 * The time to believe. `legacy` names older per-script seams that win when set (most specific first).
 * An unparseable value is ignored rather than producing an Invalid Date that silently poisons every comparison.
 */
export function clockNow(env = process.env, legacy = []) {
  for (const name of [...legacy, "ORION_NOW"]) {
    const v = env[name];
    if (v && !Number.isNaN(Date.parse(v))) return new Date(v);
  }
  return new Date();
}

/** Milliseconds since the epoch at clockNow. */
export const clockMs = (env = process.env, legacy = []) => clockNow(env, legacy).getTime();

/**
 * Should this outward action go to the outbox instead? Yes when the run is isolated and the caller is about to use the
 * REAL binary (no test seam `seam` was given).
 */
export const outboxed = (env = process.env, seam = null) => isolated(env) && !(seam && env[seam]);

/** Record an outward action that isolation stopped. Returns the row written. Never throws. */
export function toOutbox(channel, payload, { env = process.env, by = null } = {}) {
  const row = { at: clockNow(env).toISOString(), wallAt: new Date().toISOString(), channel, by, payload };
  try {
    const dir = controlledDir(env);
    mkdirSync(dir, { recursive: true });
    appendFileSync(join(dir, OUTBOX_FILE), `${JSON.stringify(row)}\n`);
  } catch { /* an outbox that cannot be written still must not send */ }
  return row;
}
