// One morning brief per day, claimed BEFORE the slow gather (2026-10-16 audit, finding 2).
// 2026-10-15: "up" (09:30Z) and "used" (09:34Z) were both processed 4 s apart; the briefed flag was
// written only after 15-20 s of gather + send, so both passed the gate and the brief went out twice,
// 2 ms apart. An O_EXCL claim file makes the claim atomic across processes.
import { writeFileSync, readFileSync, rmSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";

const file = (dir, date) => join(dir, `morning-claim-${date}.json`);
const STALE_MS = 3 * 60_000;   // a run that died holding the claim must not block the day for good

export function claimBriefing(dir, date, { now = Date.now(), staleMs = STALE_MS } = {}) {
  mkdirSync(dir, { recursive: true });
  const body = JSON.stringify({ claimedAt: now, pid: process.pid });
  const busy = (done) => ({ ok: false, reason: done ? "already briefed this morning" : "a briefing is already being prepared" });
  try { writeFileSync(file(dir, date), body, { flag: "wx" }); return { ok: true }; }
  catch (error) { if (error?.code !== "EEXIST") throw error; }
  let held = null;
  try { held = JSON.parse(readFileSync(file(dir, date), "utf8")); } catch {}
  // An unreadable file is a claim being written right now (created, not yet filled): fresh unless it is old.
  const claimedAt = held?.claimedAt ?? (() => { try { return statSync(file(dir, date)).mtimeMs; } catch { return now; } })();
  if (held?.done || now - claimedAt <= staleMs) return busy(held?.done);
  // A stale claim is taken over under a takeover lock, so two processes that both saw it stale cannot both win (the loser used to
  // delete the winner's fresh claim and then claim again).
  const takeover = `${file(dir, date)}.takeover`;
  try { writeFileSync(takeover, body, { flag: "wx" }); }
  catch (error) {
    if (error?.code !== "EEXIST") throw error;
    try { if (Date.now() - statSync(takeover).mtimeMs > 30_000) rmSync(takeover, { force: true }); } catch {}
    return busy(false);
  }
  try {
    let again = null;
    try { again = JSON.parse(readFileSync(file(dir, date), "utf8")); } catch {}
    if (again?.done || (again?.claimedAt && now - again.claimedAt <= staleMs)) return busy(again?.done);   // someone refreshed it meanwhile
    rmSync(file(dir, date), { force: true });
    writeFileSync(file(dir, date), body, { flag: "wx" });
    return { ok: true };
  } catch { return busy(false); }
  finally { rmSync(takeover, { force: true }); }
}

/** The brief went out: the claim stays, marked done. */
export function finalizeBriefing(dir, date) {
  try { writeFileSync(file(dir, date), JSON.stringify({ done: true, at: Date.now() })); } catch {}
}

/** The brief failed: let the next signal try. */
export function releaseBriefing(dir, date) { rmSync(file(dir, date), { force: true }); }
