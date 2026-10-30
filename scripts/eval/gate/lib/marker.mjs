// Holds ~/.openclaw/orion-controlled/eval-mode for the length of a run, and always lets go of it.
//
// What the marker does (read from the code, see README): every outbound sender (orion-reach,
// orion-messages-send, orion-discord-alert) reports "Not sent" instead of sending; watchers pause;
// check-ins write to eval-checkins.json; done-early skips closing loops and the focus session; the phone
// path does not save profile statements. It does NOT redirect calendar writes: the sandbox calendar needs
// a second file, eval-calendar.json, which this module refuses to run beside.
//
// Readers treat the marker as live while its mtime is under two hours old. So the file is kept backdated:
// every heartbeat sets mtime to now minus 105 minutes, which leaves 15 minutes of life. If this process
// dies without cleaning up (SIGKILL, power), the marker stops counting about 15 minutes later by itself.
import { existsSync, readFileSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";

const READER_TTL_MS = 2 * 3600_000;
const BACKDATE_MS = 105 * 60_000;
export const HEARTBEAT_MS = 60_000;

const fresh = (path, now = Date.now()) => { try { return now - statSync(path).mtimeMs < READER_TTL_MS; } catch { return false; } };

/**
 * @returns {{ release: () => void, held: boolean, expired: () => boolean }}
 * Throws when someone else's marker is live (another run) or a sandbox calendar would make writes fake.
 */
export function holdMarker({ marker, sandboxCalendar, maxAgeMs = 90 * 60_000, onExpire = () => {}, now = () => Date.now(), heartbeatMs = HEARTBEAT_MS, signals = true }) {
  if (existsSync(sandboxCalendar) && fresh(marker, now())) throw new Error(`${sandboxCalendar} exists and the marker is live: calendar writes would go to a sandbox, not Nick's calendar`);
  if (fresh(marker, now())) throw new Error(`${marker} is already live (another evaluation run?). Wait for it, or remove the file if it is stale.`);
  const token = `orion-gate pid ${process.pid} token ${Math.random().toString(36).slice(2)}`;
  const startedAt = now();
  let released = false;
  const touch = () => { const t = new Date(now() - BACKDATE_MS); utimesSync(marker, t, t); };
  writeFileSync(marker, `${token}\nstarted ${new Date(startedAt).toISOString()}\n`);
  touch();

  const release = () => {
    if (released) return;
    released = true;
    clearInterval(timer);
    for (const [sig, fn] of handlers) process.removeListener(sig, fn);
    try { if (existsSync(marker) && readFileSync(marker, "utf8").startsWith(token)) rmSync(marker, { force: true }); } catch { /* best effort */ }
  };
  const timer = setInterval(() => {
    if (now() - startedAt >= maxAgeMs) { release(); onExpire(); return; }
    try { touch(); } catch { /* marker removed under us: the run notices at the next item */ }
  }, heartbeatMs);
  timer.unref?.();

  const handlers = [];
  if (signals) {
    for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
      const fn = () => { release(); process.exit(128 + ({ SIGINT: 2, SIGTERM: 15, SIGHUP: 1 }[sig])); };
      handlers.push([sig, fn]); process.on(sig, fn);
    }
    const onExit = () => release();
    handlers.push(["exit", onExit]); process.on("exit", onExit);
  }
  return { release, get held() { return !released; }, expired: () => released || now() - startedAt >= maxAgeMs };
}
