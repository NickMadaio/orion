// Messages held back (quiet hours, a running focus session) are queued, never
// dropped (2026-10-16 audit, finding 4: orion-reach logged "hold" and kept nothing).
// They are released once, merged, when it is no longer quiet and no session runs.
import { appendFileSync, readFileSync, writeFileSync, renameSync, mkdirSync, existsSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

const file = (dir) => join(dir, "held.jsonl");

// clearHeld rewrites the file; an append landing between its read and its rename was silently lost. Both go through one lock.
function withLock(dir, fn) {
  mkdirSync(dir, { recursive: true });
  const lock = `${file(dir)}.lock`;
  for (let i = 0; i < 400; i++) {
    try { writeFileSync(lock, String(process.pid), { flag: "wx" }); }
    catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try { if (Date.now() - statSync(lock).mtimeMs > 10_000) rmSync(lock, { force: true }); } catch {}   // a dead holder
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      continue;
    }
    try { return fn(); } finally { rmSync(lock, { force: true }); }
  }
  return fn();   // never lose a message to a stuck lock: when unsure, deliver
}

export function appendHeld(dir, entry) {
  withLock(dir, () => appendFileSync(file(dir), `${JSON.stringify(entry)}\n`));
}

export function readHeld(dir) {
  if (!existsSync(file(dir))) return [];
  return readFileSync(file(dir), "utf8").split("\n").flatMap((l) => { try { return l.trim() ? [JSON.parse(l)] : []; } catch { return []; } });
}

export function clearHeld(dir, released) {
  const gone = new Set(released.map((e) => e.id));
  withLock(dir, () => {
    const keep = readHeld(dir).filter((e) => !gone.has(e.id));
    const tmp = `${file(dir)}.tmp`;
    writeFileSync(tmp, keep.map((e) => JSON.stringify(e)).join("\n") + (keep.length ? "\n" : ""));
    renameSync(tmp, file(dir));
  });
}

/**
 * One message from everything held: stale entries (older than maxAgeMs, or marked
 * `expires`, like a bedtime nag that is pointless in the morning) are left out.
 * @returns { text, used, stale } text is null when nothing is worth saying
 */
export function mergeHeld(entries, { now = Date.now(), maxAgeMs = 12 * 3600_000 } = {}) {
  const fresh = [], stale = [];
  for (const e of entries.filter((x) => x.via !== "alerts-outbox")) (e.expires || now - Date.parse(e.at) > maxAgeMs ? stale : fresh).push(e);
  const seen = new Set();
  const lines = fresh.map((e) => String(e.text).trim()).filter((t) => t && !seen.has(t) && seen.add(t));
  if (!lines.length) return { text: null, used: fresh, stale };
  const text = lines.length === 1 ? lines[0] : `While you were out of reach: ${lines.map((t) => t.replace(/[.!]$/, "")).join(". ")}.`;
  return { text, used: fresh, stale };
}

/**
 * Alerts the watchers wanted to send during a focus session (via "alerts-outbox") move to the phone's
 * alerts outbox once the session is over. Returns what was released.
 */
export function releaseHeldAlerts(dir) {
  const mine = readHeld(dir).filter((e) => e.via === "alerts-outbox");
  if (!mine.length) return [];
  mkdirSync(dir, { recursive: true });
  for (const e of mine) appendFileSync(join(dir, "alerts-outbox.jsonl"), `${JSON.stringify({ id: e.alertId ?? e.id, level: e.level ?? 1, text: e.text, kind: "checkin" })}\n`);
  clearHeld(dir, mine);
  return mine;
}
