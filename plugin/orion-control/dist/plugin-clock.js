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
const controlledDir = () => process.env.ORION_CONTROLLED_DIR || join(homedir(), ".openclaw", "orion-controlled");
const fresh = (path, now) => { try {
    return now - statSync(path).mtimeMs < SANDBOX_TTL_MS;
}
catch {
    return false;
} };
/** The sandbox's `now` in ms when a fresh evaluation sandbox is active, else null. */
export function sandboxNowMs(opts = {}) {
    const dir = opts.dir ?? controlledDir();
    const real = (opts.realNow ?? Date.now)();
    const calendar = join(dir, "eval-calendar.json");
    if (!fresh(join(dir, "eval-mode"), real) || !fresh(calendar, real))
        return null;
    try {
        const now = JSON.parse(readFileSync(calendar, "utf8")).now;
        const ms = typeof now === "string" ? Date.parse(now) : NaN;
        return Number.isFinite(ms) ? ms : null;
    }
    catch {
        return null;
    }
}
export const pluginNowMs = (opts = {}) => sandboxNowMs(opts) ?? (opts.realNow ?? Date.now)();
export const pluginNow = (opts = {}) => new Date(pluginNowMs(opts));
