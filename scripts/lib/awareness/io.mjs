// Small file helpers for the awareness files: tolerant reads, and writes that are locked and tmp+renamed
// (the held.mjs pattern) so a reader never sees half a file and two writers never interleave.
import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

export const readJson = (path) => { try { return JSON.parse(readFileSync(path, "utf8")); } catch { return null; } };

const sleepMs = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function withLock(path, fn) {
  const lock = `${path}.lock`;
  for (let i = 0; i < 400; i++) {
    try { writeFileSync(lock, String(process.pid), { flag: "wx" }); }
    catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try { if (Date.now() - statSync(lock).mtimeMs > 10_000) rmSync(lock, { force: true }); } catch {}   // a dead holder
      sleepMs(10);
      continue;
    }
    try { return fn(); } finally { rmSync(lock, { force: true }); }
  }
  return fn();   // a stuck lock must not stop a refresh
}

/** Write `value` as JSON to dir/name, atomically. */
export function writeJsonAtomic(dir, name, value) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  withLock(path, () => {
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`);
    renameSync(tmp, path);
  });
}

/** Read, change and write back one JSON file under the lock (so two updaters cannot lose each other's change). */
export function updateJson(dir, name, change, fallback = {}) {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  withLock(path, () => {
    const next = change(readJson(path) ?? fallback);
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(next, null, 2)}\n`);
    renameSync(tmp, path);
  });
}
