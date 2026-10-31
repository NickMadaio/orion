// The wall clock routing and reply logic reason with (2026-10-31).
//
// Normally the real time. During a sandboxed evaluation (the eval-mode marker is live AND
// eval-calendar.json exists, the same pair scripts/lib/life/bridge-path.mjs and undoJournalTop use)
// it is the sandbox's own `now`, so "what's next", "is it past 6" and slot searches agree with the
// calendar the scripts are reading. The sandbox file must itself be under two hours old: a calendar
// left behind by a killed run can never pin ORION's sense of time.
//
// Use it ONLY where an answer depends on what time it is. Latency, TTL, approval, timeout, rate-limit
// and log timestamps stay on Date.now(): they measure real elapsed time.
import { readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export const SANDBOX_TTL_MS = 2 * 3600_000;

export type ClockOpts = { dir?: string; realNow?: () => number };

const controlledDir = () => process.env.ORION_CONTROLLED_DIR || join(homedir(), ".openclaw", "orion-controlled");
const fresh = (path: string, now: number) => { try { return now - statSync(path).mtimeMs < SANDBOX_TTL_MS; } catch { return false; } };

const CACHE_MS = 1000;
const cache = new Map<string, { at: number; value: number | null }>();
/** Forget cached answers (tests). */
export const resetClockCache = (): void => cache.clear();

function readSandboxNow(dir: string, real: number): number | null {
  const calendar = join(dir, "eval-calendar.json");
  if (!fresh(join(dir, "eval-mode"), real) || !fresh(calendar, real)) return null;
  try {
    const now = (JSON.parse(readFileSync(calendar, "utf8")) as { now?: unknown }).now;
    const ms = typeof now === "string" ? Date.parse(now) : NaN;
    return Number.isFinite(ms) ? ms : null;
  } catch { return null; }
}

/**
 * The sandbox's `now` in ms when a fresh evaluation sandbox is active, else null. Many calls per turn, so the stat/read
 * answer is kept for about a second per directory. An injected realNow (tests) always bypasses the cache.
 */
export function sandboxNowMs(opts: ClockOpts = {}): number | null {
  const dir = opts.dir ?? controlledDir();
  if (opts.realNow) return readSandboxNow(dir, opts.realNow());
  const t = Date.now();
  const hit = cache.get(dir);
  if (hit && t - hit.at < CACHE_MS) return hit.value;
  const value = readSandboxNow(dir, t);
  cache.set(dir, { at: t, value });
  return value;
}

export const pluginNowMs = (opts: ClockOpts = {}): number => sandboxNowMs(opts) ?? (opts.realNow ?? Date.now)();
export const pluginNow = (opts: ClockOpts = {}): Date => new Date(pluginNowMs(opts));
