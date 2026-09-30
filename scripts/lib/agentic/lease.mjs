/*
 Exclusive leases with PROOF of who holds them.

 THE PROBLEM THIS SOLVES

 The controller's first lease was a bare `mkdir` — correct for exclusion, useless
 for recovery. When a worker times out with an unknown outcome the lease is
 deliberately retained, and the Astra handoff is explicit that there was then no
 process-owner proof and no reconciliation API: "do not manually clear it while
 an unknown worker may survive". On an unattended overnight run that turns one
 hung process into a system that is stuck until a human is awake.

 Clearing it safely needs an answer to "is the holder still running?", and a PID
 alone cannot answer it — PIDs are reused, and a reused PID reads as "still
 alive" while naming an unrelated process. That misidentification is recorded in
 this project's own history against the legacy coder.

 THREE FACTS, AND WHEN THEY PROVE DEATH

   bootId     the machine's boot time. Different boot => the holder cannot
              possibly be running. This is the case that matters most, because
              an overnight crash and a reboot is the common one.
   pid        signal 0 says whether SOMETHING holds that number.
   startedAt  the holder's own recorded start instant, compared against what
              `ps` says that PID started. Different => the number was reused.

 Death is proven when the boot differs, OR the PID is absent, OR the PID's start
 time disagrees. Anything else — including "cannot tell" — is treated as alive,
 because a lease wrongly cleared starts a second writer against the same
 worktree, and two writers is the failure this file exists to make impossible.
*/
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, rm, writeFile, lstat } from 'node:fs/promises';
import { join } from 'node:path';

let cachedBootId;

/** A stable identifier for this boot of the machine. */
export function bootId() {
  if (cachedBootId) return cachedBootId;
  try {
    const raw = execFileSync('/usr/sbin/sysctl', ['-n', 'kern.boottime'], { encoding: 'utf8', timeout: 5000 });
    cachedBootId = (raw.match(/sec\s*=\s*(\d+)/)?.[1]) ?? null;
  } catch { cachedBootId = null; }
  // A machine whose boot time cannot be read gets a per-process identity
  // instead. That is strictly SAFER: it never matches a stored boot, so an
  // orphaned lease is never cleared on evidence this process could not gather.
  if (!cachedBootId) cachedBootId = `unknown-${process.pid}-${Date.now()}`;
  return cachedBootId;
}

/** What `ps` reports as a PID's start instant, or null when it cannot be read. */
export function processStartedAt(pid) {
  try {
    const raw = execFileSync('/bin/ps', ['-o', 'lstart=', '-p', String(pid)], { encoding: 'utf8', timeout: 5000 });
    const trimmed = raw.trim();
    return trimmed || null;
  } catch { return null; }
}

function pidPresent(pid) {
  try { process.kill(pid, 0); return true; }
  catch (error) { return error.code === 'EPERM'; }
}

/**
 * Decide whether a recorded lease owner is provably dead.
 * Returns `{ dead, reason }`; `dead: false` means "alive, or not provable".
 */
export function ownerIsProvablyDead(owner) {
  if (!owner || typeof owner !== 'object') return { dead: false, reason: 'the lease carries no owner record; it cannot be cleared automatically' };
  if (typeof owner.pid !== 'number' || !Number.isInteger(owner.pid) || owner.pid <= 0) {
    return { dead: false, reason: 'the lease owner record has no usable pid' };
  }
  if (owner.bootId !== bootId()) return { dead: true, reason: `held by a process from a previous boot (${owner.bootId})` };
  if (!pidPresent(owner.pid)) return { dead: true, reason: `pid ${owner.pid} is no longer present on this boot` };
  const current = processStartedAt(owner.pid);
  if (owner.startedAt && current && current !== owner.startedAt) {
    return { dead: true, reason: `pid ${owner.pid} was reused; it now belongs to a process started ${current}` };
  }
  if (owner.pid === process.pid && owner.startedAt === processStartedAt(process.pid)) {
    return { dead: false, reason: 'held by this very process' };
  }
  return { dead: false, reason: `pid ${owner.pid} is still running` };
}

export function ownerRecord(extra = {}) {
  return {
    pid: process.pid,
    bootId: bootId(),
    startedAt: processStartedAt(process.pid),
    acquiredAt: new Date().toISOString(),
    ...extra,
  };
}

export class LeaseHeldError extends Error {
  constructor(path, owner, reason) {
    super(`lease ${path} is held: ${reason}`);
    this.name = 'LeaseHeldError';
    this.owner = owner;
    this.reason = reason;
  }
}

export async function readLeaseOwner(path) {
  try { return JSON.parse(await readFile(join(path, 'owner.json'), 'utf8')); }
  catch { return null; }
}

/**
 * Take an exclusive lease. `mkdir` is the atomic primitive; the owner record is
 * written immediately after so a crash between the two leaves a lease with no
 * owner — which `ownerIsProvablyDead` refuses to clear, the safe direction.
 */
export async function acquireLease(path, { extra = {}, reclaimDead = true } = {}) {
  try {
    await mkdir(path, { mode: 0o700 });
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const owner = await readLeaseOwner(path);
    const verdict = ownerIsProvablyDead(owner);
    if (!reclaimDead || !verdict.dead) throw new LeaseHeldError(path, owner, verdict.reason);
    // Serialize reclaimers too. Two callers can both observe the same dead
    // owner; an in-place overwrite alone lets both believe they own the lease.
    // An orphaned reclaim guard fails closed rather than admitting two writers.
    const reclaim = `${path}.reclaim`;
    try { await mkdir(reclaim, { mode: 0o700 }); }
    catch { throw new LeaseHeldError(path, owner, 'lease recovery is already in progress or requires investigation'); }
    try {
      const latest = await readLeaseOwner(path);
      const proof = ownerIsProvablyDead(latest);
      if (!proof.dead) throw new LeaseHeldError(path, latest, proof.reason);
      await writeFile(join(path, 'owner.json'), JSON.stringify(ownerRecord({ ...extra, reclaimedFrom: latest, reclaimReason: proof.reason })), { mode: 0o600 });
      return { reclaimed: true, previousOwner: latest, reason: proof.reason };
    } finally { await rm(reclaim, { recursive: true, force: true }); }
  }
  await writeFile(join(path, 'owner.json'), JSON.stringify(ownerRecord(extra)), { mode: 0o600 });
  return { reclaimed: false, previousOwner: null, reason: null };
}

export async function releaseLease(path) {
  await rm(path, { recursive: true, force: true });
}

/** Inspect a lease without taking it — what the operator CLI and UI report. */
export async function inspectLease(path) {
  const owner = await readLeaseOwner(path);
  if (!owner) {
    try { await lstat(path); }
    catch (error) {
      if (error.code === 'ENOENT') return { held: false, owner: null, dead: null, reason: 'no lease' };
      throw error;
    }
    return { held: true, owner: null, dead: false, reason: 'the lease carries no usable owner record; recovery requires operator investigation' };
  }
  const verdict = ownerIsProvablyDead(owner);
  return { held: true, owner, dead: verdict.dead, reason: verdict.reason };
}
