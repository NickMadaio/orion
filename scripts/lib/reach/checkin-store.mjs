// checkins.json without lost updates (2026-10-31 review, finding 7). `orion-checkin tick` holds the state across ~60 s of
// spawns (orion-reach, orion-reschedule) and used to save it blind, so a reply that landed meanwhile ("started", a grace)
// was overwritten. Now every save re-reads the file under a short lock and merges by id against what this process loaded:
//   - a check-in only this process changed: ours;      - only the file changed (a reply meanwhile): the file's;
//   - both changed: the file's (his reply wins), with any ladder message this process sent added to it, so it is not resent;
//   - new in the file: kept;  dropped by this process (pruned) and unchanged in the file: dropped.
import { readFileSync, writeFileSync, renameSync, mkdirSync, rmSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const byId = (list) => new Map((list ?? []).map((c) => [c.id, c]));

function withSent(disk, ours) {
  const have = new Set((disk.ladder?.sent ?? []).map((s) => s.msgId));
  const extra = (ours.ladder?.sent ?? []).filter((s) => !have.has(s.msgId));
  return extra.length ? { ...disk, ladder: { ...(disk.ladder ?? {}), sent: [...(disk.ladder?.sent ?? []), ...extra] } } : disk;
}

/** Pure: the state to write, from what was loaded (base), what this process holds (ours) and what is on disk now (disk). */
export function mergeCheckins(base, ours, disk) {
  const b = byId(base?.checkins), o = byId(ours?.checkins), d = byId(disk?.checkins);
  const pick = (id) => {
    const was = b.get(id), mine = o.get(id), theirs = d.get(id);
    if (!theirs) return was ? null : mine ?? null;                    // removed on disk meanwhile (or never there): ours only if new
    if (!mine) return was && same(was, theirs) ? null : theirs;        // pruned here: dropped unless changed on disk meanwhile
    const changedHere = !was || !same(was, mine), changedThere = !was || !same(was, theirs);
    if (changedHere && changedThere) return was ? withSent(theirs, mine) : mine;
    return changedHere ? mine : theirs;
  };
  const order = [...(ours?.checkins ?? []).map((c) => c.id), ...(disk?.checkins ?? []).map((c) => c.id).filter((id) => !o.has(id))];
  const checkins = [...new Set(order)].map(pick).filter(Boolean);
  const rest = Object.fromEntries(Object.entries(ours ?? {}).filter(([k]) => k !== "checkins"));
  const diskRest = Object.fromEntries(Object.entries(disk ?? {}).filter(([k]) => k !== "checkins"));
  const top = Object.fromEntries([...new Set([...Object.keys(rest), ...Object.keys(diskRest)])].map((k) =>
    [k, same(base?.[k], rest[k]) && k in diskRest ? diskRest[k] : (k in rest ? rest[k] : diskRest[k])]));
  return { ...top, checkins };
}

function withLock(file, fn) {
  mkdirSync(dirname(file), { recursive: true });
  const lock = `${file}.lock`;
  for (let i = 0; i < 300; i++) {
    try { writeFileSync(lock, String(process.pid), { flag: "wx" }); }
    catch (error) {
      if (error?.code !== "EEXIST") throw error;
      try { if (Date.now() - statSync(lock).mtimeMs > 10_000) rmSync(lock, { force: true }); } catch { /* gone already */ }
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 10);
      continue;
    }
    try { return fn(); } finally { rmSync(lock, { force: true }); }
  }
  return fn();   // a stuck lock never loses a save
}

const readState = (file) => { try { return JSON.parse(readFileSync(file, "utf8")); } catch { return null; } };

/**
 * A store over one checkins.json. load() remembers what it read; save(state) merges against the file as it is now and
 * returns the merged state (the caller keeps using it).
 */
export function checkinStore(file) {
  let base = { checkins: [] };
  return {
    load() { base = readState(file) ?? { checkins: [] }; return structuredClone(base); },
    save(state) {
      return withLock(file, () => {
        const merged = mergeCheckins(base, state, readState(file) ?? base);   // unreadable now: nothing to merge with
        const tmp = `${file}.${randomBytes(4).toString("hex")}.tmp`;
        writeFileSync(tmp, JSON.stringify(merged, null, 2), { mode: 0o600 }); renameSync(tmp, file);
        base = structuredClone(merged);
        return merged;
      });
    },
  };
}
