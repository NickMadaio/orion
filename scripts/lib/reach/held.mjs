// Messages held back (quiet hours, a running focus session) are queued, never
// dropped (2026-10-16 audit, finding 4: orion-reach logged "hold" and kept nothing).
// They are released once, merged, when the gate allows it: a break, the end of a session, morning, the end of class.
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

const LABELS = { focus: "While you were focused", quiet: "While you were asleep", class: "While you were in class" };
const MAX_LINES = 3;
const strip = (t) => t.replace(/[.!]$/, "");

/**
 * One message from everything held, by a code template (no LLM). Stale entries are left out: older than maxAgeMs,
 * marked `expires` (a bedtime nag is pointless in the morning), past their own `validUntil`, or a question with an
 * `ask` (stale by definition; the loop re-decides it with fresh facts).
 * One item is said as itself. Several share a label when they were held for the same reason ("While you were
 * focused: A. B."), at most 3 lines and then "+N more in chat".
 * @returns { text, used, stale, lines, label } text is null when nothing is worth saying. `lines` and `label` let
 *   the session-done line absorb a focus merge.
 */
export function mergeHeld(entries, { now = Date.now(), maxAgeMs = 12 * 3600_000 } = {}) {
  const fresh = [], stale = [];
  for (const e of entries.filter((x) => x.via !== "alerts-outbox")) {
    const old = e.expires || now - Date.parse(e.at) > maxAgeMs || (e.validUntil && Date.parse(e.validUntil) < now) || (e.kind === "question" && e.ask);
    (old ? stale : fresh).push(e);
  }
  const seen = new Set();
  const unique = fresh.filter((e) => { const t = String(e.text).trim(); return t && !seen.has(t) && seen.add(t); });
  const lines = unique.map((e) => String(e.text).trim());
  if (!lines.length) return { text: null, used: fresh, stale, lines, label: null };
  const reasons = new Set(unique.map((e) => e.heldFor));
  const label = reasons.size === 1 && LABELS[[...reasons][0]] ? LABELS[[...reasons][0]] : "While you were out of reach";
  if (lines.length === 1) return { text: lines[0], used: fresh, stale, lines, label };
  const shown = lines.slice(0, MAX_LINES).map(strip).join(". ");
  const more = lines.length > MAX_LINES ? ` +${lines.length - MAX_LINES} more in chat.` : "";
  return { text: `${label}: ${shown}.${more}`, used: fresh, stale, lines, label };
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
