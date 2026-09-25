import { createHash, randomBytes } from "node:crypto";
import { mkdir, writeFile, rename, stat, constants, open, unlink, link, rmdir, readFile } from "node:fs/promises";
import { join } from "node:path";

// Pure disabled-schedule read-back verifier. No filesystem, network or scheduler effects.
export function verifyDisabledSchedule(expected, observed) {
  try {
    if (typeof expected !== "object" || expected === null ||
        typeof observed !== "object" || observed === null) return false;

    // id: nonempty string
    if (typeof observed.id !== "string" || observed.id.length === 0) return false;

    // name, timeZone, cron must equal the expected plan fields exactly
    if (observed.name !== expected.name) return false;
    if (observed.timeZone !== expected.timeZone) return false;
    if (observed.cron !== expected.cron) return false;

    // commandArgv: array with identical length and strict per-index equality
    if (!Array.isArray(observed.commandArgv)) return false;
    if (observed.commandArgv.length !== expected.commandArgv.length) return false;
    for (let i = 0; i < observed.commandArgv.length; i++) {
      if (observed.commandArgv[i] !== expected.commandArgv[i]) return false;
    }

    // cwd: must equal the value immediately after --command-cwd in schedulerArgs
    const args = expected.schedulerArgs;
    if (!Array.isArray(args)) return false;
    let cwdIndex = -1;
    for (let i = 0; i < args.length; i++) {
      if (args[i] === "--command-cwd") { cwdIndex = i; break; }
    }
    if (cwdIndex === -1 || cwdIndex + 1 >= args.length) return false;
    const expectedCwd = args[cwdIndex + 1];
    if (observed.cwd !== expectedCwd) return false;

    // enabled must be exactly false, exact must be exactly true, noDeliver must be exactly true
    if (observed.enabled !== false) return false;
    if (observed.exact !== true) return false;
    if (observed.noDeliver !== true) return false;

    return true;
  } catch {
    return false;
  }
}

/**
 * Durable disabled installation transaction.
 *
 * Never enables a job. Persists an exclusive per-name transaction intent before
 * any scheduler effect, records the returned scheduler id, verifies disabled
 * read-back, initializes dispatch, publishes the installed record, then marks
 * the transaction complete.
 *
 * Scheduler adapter contract (documented for tasks 3-4):
 *   createDisabled(plan) -> Promise<{id: string}> with non-empty string id; anything else is unknown outcome.
 *   read(id) -> Promise<object|null> normalized job shape; null only when scheduler positively reports no such job; rejects when uncertain.
 *   remove(id) -> Promise<void>. This task never calls remove, and nothing ever enables a job.
 *
 * @param {{
 *   root: string,
 *   proposal: object,
 *   timeZone: string,
 *   repoRoot: string,
 *   scheduler: { createDisabled(plan): Promise<{id: string}>, read(id): Promise<object|null>, remove(id): Promise<void> },
 *   now: number
 * }} params
 * @returns {Promise<object>} verified disabled state or error classification
 */
export async function installDisabledAutomation({ root, proposal, timeZone, repoRoot, scheduler, now }) {
  // --- validate inputs: all roots and scheduler adapter required, no defaults ---
  if (!root || typeof root !== "string") throw new TypeError("root must be a non-empty string");
  if (!proposal || typeof proposal !== "object") throw new TypeError("proposal is required");
  if (!timeZone || typeof timeZone !== "string") throw new TypeError("timeZone is required");
  if (!repoRoot || typeof repoRoot !== "string") throw new TypeError("repoRoot must be a non-empty string");
  if (!scheduler || typeof scheduler.createDisabled !== "function" ||
      typeof scheduler.read !== "function" || typeof scheduler.remove !== "function") {
    throw new TypeError("scheduler adapter must expose createDisabled, read, remove");
  }
  // now must be a safe-integer epoch-ms number, NOT a Date
  if (!Number.isSafeInteger(now)) throw new TypeError("now must be a safe-integer epoch-ms number");

  // --- build schedule plan (validates name, throws on bad input) ---
  const { automationSchedulePlan } = await import("./orion-automation-schedule.mjs");
  const plan = automationSchedulePlan(proposal, timeZone, repoRoot, now);

  // --- assemble installed record: bare name, policy fields SPREAD at top level ---
  const installationId = randomBytes(16).toString("hex");
  const bareName = proposal.name;
  const installedAt = new Date(now).toISOString();

  // The record shape consumed by runInstalledAutomation and initializeAutomationDispatch.
  // Policy fields sit at TOP level, not nested under "policy".
  const installedRecord = {
    name: bareName,
    installationId,
    installedAt,
    timeZone,
    trigger: proposal.trigger,
    ...plan.policy,
  };

  // --- transaction tracking ---
  const txDir = join(root, "transactions");
  const txFile = join(txDir, `${bareName}.json`);
  const lockDir = join(txDir, `${bareName}.lock`);
  const installedPath = join(root, "installed", `${bareName}.json`);

  let phase = "create_pending";
  let evidence = {};
  let schedulerId = null;
  let createdLock = false;

  async function persistTransaction() {
    await mkdir(txDir, { recursive: true });
    const data = JSON.stringify({
      version: 1,
      name: bareName,
      phase,
      installationId,
      installedAt,
      timeZone,
      schedulerId,
      plan,
      record: installedRecord,
      evidence,
    }, null, 2);
    const tmpFile = join(txDir, `${bareName}.${randomBytes(8).toString("hex")}.tmp`);
    const handle = await open(tmpFile, "wx", 0o600);
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(tmpFile, txFile);
    // fsync directory for durability
    const dirFd = await open(txDir, constants.O_RDONLY);
    try { await dirFd.fdatasync(); } catch { /* best effort */ }
    finally { await dirFd.close(); }
  }

  // --- ensure transactions directory exists before lock attempt ---
  await mkdir(txDir, { recursive: true });

  // --- exclusive per-name intent: acquire lock ---
  // Check if lock already exists before trying to create it
  try {
    await stat(lockDir);
    // Lock exists — concurrent or prior installation
    // Check for pre-existing installed record
    try {
      await stat(installedPath);
      return { status: "already_installed", reason: `installation ${bareName} already exists`, phase };
    } catch { /* no existing record */ }

    // Check for active/uncertain transaction
    try {
      const existing = JSON.parse(await readFile(txFile, "utf8"));
      if (existing.phase && !["complete", "publication_failed"].includes(existing.phase)) {
        return { status: "transaction_active", reason: `uncertain transaction in phase ${existing.phase}`, phase };
      }
    } catch { /* no existing transaction */ }

    // Concurrent same-name call — refuse without overwriting
    return { status: "concurrent_refused", reason: "another installation holds the lock", phase };
  } catch {
    // Lock doesn't exist, try to create it
    try {
      await mkdir(lockDir);
      createdLock = true;
    } catch (err) {
      if (err.code === "EEXIST") {
        // Another call created the lock between our stat and mkdir — refuse
        return { status: "concurrent_refused", reason: "another installation holds the lock", phase };
      }
      throw err;
    }
  }

  try {
    // --- refuse if installed record or transaction already exists ---
    try {
      await stat(installedPath);
      return { status: "already_installed", reason: `installation ${bareName} already exists`, phase };
    } catch { /* no existing record */ }

    try {
      await stat(txFile);
      return { status: "transaction_exists", reason: `transaction for ${bareName} already exists`, phase };
    } catch { /* no existing transaction */ }

    // --- persist transaction intent BEFORE any scheduler effect ---
    await persistTransaction();

    // --- create disabled job on scheduler ---
    let jobId;
    try {
      const result = await scheduler.createDisabled(plan);
      if (!result || typeof result.id !== "string" || result.id.length === 0) {
        phase = "create_pending";
        evidence.create_error = "scheduler returned no valid id";
        await persistTransaction();
        return { status: "unknown_outcome", reason: "scheduler create returned invalid id", phase, evidence };
      }
      jobId = result.id;
      schedulerId = jobId;
    } catch (err) {
      phase = "create_pending";
      evidence.create_error = err.message;
      await persistTransaction();
      return { status: "unknown_outcome", reason: "scheduler create failed, outcome uncertain", phase, evidence };
    }

    // --- persist id BEFORE calling read ---
    phase = "job_known";
    await persistTransaction();

    // --- read back and verify disabled state ---
    let observed;
    try {
      observed = await scheduler.read(jobId);
    } catch (err) {
      // Keep job_known, store error
      evidence.read_error = err.message;
      await persistTransaction();
      return { status: "verification_failed", reason: "scheduler read failed after create", phase, evidence };
    }

    if (!observed || !verifyDisabledSchedule(plan, observed)) {
      // Keep job_known, store observation or error
      evidence.read_back_mismatch = true;
      evidence.observed = observed;
      await persistTransaction();
      return { status: "verification_failed", reason: "read-back did not match expected disabled state", phase, evidence };
    }

    // --- initialize dispatch and publish installed record ---
    try {
      const { initializeAutomationDispatch } = await import("./orion-automation-dispatch.mjs");
      const runtimeDir = join(root, "runtime");
      await initializeAutomationDispatch(runtimeDir, installedRecord);

      // Publish byte-equivalent record at root/installed/<bare-name>.json
      // Use temp file + link (not rename which overwrites)
      const installedDir = join(root, "installed");
      await mkdir(installedDir, { recursive: true });
      const data = JSON.stringify(installedRecord, null, 2);
      const tmpFile = join(installedDir, `${bareName}.${randomBytes(8).toString("hex")}.tmp`);
      const handle = await open(tmpFile, "wx", 0o600);
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      // link instead of rename: EEXIST means refuse, don't overwrite
      await link(tmpFile, installedPath);
      await unlink(tmpFile);

      // fsync directory for durability
      const dirFd = await open(installedDir, constants.O_RDONLY);
      try { await dirFd.fdatasync(); } catch { /* best effort */ }
      finally { await dirFd.close(); }
    } catch (err) {
      phase = "publication_failed";
      evidence.publication_error = err.message;
      await persistTransaction();
      return { status: "publication_failed", reason: "dispatch or record publication failed", phase, evidence };
    }

    // --- mark transaction complete ---
    phase = "complete";
    evidence.disabled_verified = true;
    await persistTransaction();

    return {
      status: "disabled_verified",
      name: bareName,
      installationId,
      schedulerId: jobId,
      enabled: false,
    };
  } finally {
    // Release the lock only if this call created it
    if (createdLock) {
      try { await rmdir(lockDir); } catch { /* best effort */ }
    }
  }
}

/**
 * Reconcile an incomplete disabled installation transaction.
 *
 * Conservative: never creates or enables jobs, never resets consumed quotas,
 * never guesses that a live lock owner is dead. Only inspects and optionally
 * removes known disabled jobs when exact identity matches.
 *
 * @param {{
 *   root: string,
 *   name: string,
 *   scheduler: { read(id): Promise<object|null>, remove(id): Promise<void> }
 * }} params
 * @returns {Promise<object>} reconciliation status
 */
export async function reconcileDisabledAutomation({ root, name, scheduler }) {
  // --- validate inputs ---
  if (!root || typeof root !== "string") throw new TypeError("root must be a non-empty string");
  if (!name || typeof name !== "string" || !/^[a-z0-9][a-z0-9-]{1,47}$/.test(name)) {
    throw new TypeError("name must match /^[a-z0-9][a-z0-9-]{1,47}$/");
  }
  if (!scheduler || typeof scheduler.read !== "function" || typeof scheduler.remove !== "function") {
    throw new TypeError("scheduler adapter must expose read and remove functions");
  }

  const txDir = join(root, "transactions");
  const txFile = join(txDir, `${name}.json`);
  const lockDir = join(txDir, `${name}.lock`);
  const installedPath = join(root, "installed", `${name}.json`);

  // --- ensure transactions directory exists before lock attempt ---
  await mkdir(txDir, { recursive: true });

  // --- acquire per-name lock; on EEXIST return busy, never break a lock ---
  // NOTE: must NOT use { recursive: true } here — that suppresses EEXIST
  // and would silently succeed even when another process holds the lock.
  let createdLock = false;
  try {
    await mkdir(lockDir);
    createdLock = true;
  } catch (err) {
    if (err.code === "EEXIST") {
      return { status: "busy" };
    }
    throw err;
  }

  try {
    // --- read transaction file ---
    let tx;
    try {
      const raw = await readFile(txFile, "utf8");
      tx = JSON.parse(raw);
    } catch {
      return { status: "no_transaction" };
    }

    // --- helper: append evidence and persist transaction atomically ---
    async function appendEvidence(entry) {
      if (!tx.evidence) tx.evidence = {};
      if (!Array.isArray(tx.evidence.reconcile)) tx.evidence.reconcile = [];
      tx.evidence.reconcile.push(entry);

      await mkdir(txDir, { recursive: true });
      const data = JSON.stringify(tx, null, 2);
      const tmpFile = join(txDir, `${name}.${randomBytes(8).toString("hex")}.tmp`);
      const handle = await open(tmpFile, "wx", 0o600);
      try {
        await handle.writeFile(data);
        await handle.sync();
      } finally {
        await handle.close();
      }
      await rename(tmpFile, txFile);
      // fsync directory for durability
      const dirFd = await open(txDir, constants.O_RDONLY);
      try { await dirFd.fdatasync(); } catch { /* best effort */ }
      finally { await dirFd.close(); }
    }

    const phase = tx.phase;
    const schedulerId = tx.schedulerId;
    const storedPlan = tx.plan;

    // --- no plan stored: cannot reconcile safely ---
    if (!storedPlan) {
      await appendEvidence({ status: "intervention_required", reason: "missing_plan" });
      return { status: "intervention_required", reason: "transaction lacks stored plan" };
    }

    // --- create_pending with no schedulerId: blocked, never create a replacement ---
    if (phase === "create_pending" && !schedulerId) {
      await appendEvidence({ status: "blocked_unknown_create", detail: "no scheduler id recorded" });
      return { status: "blocked_unknown_create" };
    }

    // --- complete phase: inspect only, never mutate ---
    if (phase === "complete") {
      let observed;
      try {
        observed = await scheduler.read(schedulerId);
      } catch {
        await appendEvidence({ status: "intervention_required", reason: "read_failed" });
        return { status: "intervention_required", reason: "read_failed" };
      }

      // Must be positively present (not null) for verification
      if (!observed) {
        await appendEvidence({ status: "intervention_required", reason: "missing_job" });
        return { status: "intervention_required", reason: "missing_job" };
      }

      // Verify id matches exactly
      if (observed.id !== schedulerId) {
        await appendEvidence({ status: "intervention_required", reason: "mismatch" });
        return { status: "intervention_required", reason: "mismatch" };
      }

      // Verify disabled schedule content
      if (!verifyDisabledSchedule(storedPlan, observed)) {
        // Check if it's enabled specifically
        if (observed.enabled === true) {
          await appendEvidence({ status: "intervention_required", reason: "enabled" });
          return { status: "intervention_required", reason: "enabled" };
        }
        await appendEvidence({ status: "intervention_required", reason: "mismatch" });
        return { status: "intervention_required", reason: "mismatch" };
      }

      // Check installed record's installationId matches transaction's
      let installedRecord;
      try {
        const raw = await readFile(installedPath, "utf8");
        installedRecord = JSON.parse(raw);
      } catch {
        await appendEvidence({ status: "intervention_required", reason: "missing_installed_record" });
        return { status: "intervention_required", reason: "missing_installed_record" };
      }

      if (installedRecord.installationId !== tx.installationId) {
        await appendEvidence({ status: "intervention_required", reason: "mismatch" });
        return { status: "intervention_required", reason: "mismatch" };
      }

      // All checks pass: verified, write nothing so second call gives identical bytes
      await appendEvidence({ status: "complete_verified", detail: "all checks passed" });
      return { status: "complete_verified" };
    }

    // --- incomplete phases with schedulerId: job_known, disabled_verified, publication_failed ---
    if (!schedulerId) {
      // Should not reach here given create_pending handling above, but be safe
      await appendEvidence({ status: "blocked_unknown_create", detail: `phase ${phase} without scheduler id` });
      return { status: "blocked_unknown_create" };
    }

    // Read the job from scheduler
    let observed;
    try {
      observed = await scheduler.read(schedulerId);
    } catch {
      // Read rejected: unknown outcome, do not remove
      await appendEvidence({ status: "unknown_outcome", reason: "read_failed" });
      return { status: "unknown_outcome", reason: "scheduler read failed" };
    }

    // Resolved null: job is gone
    if (observed === null) {
      await appendEvidence({ status: "verified_absent", detail: "scheduler reports no such job" });
      return { status: "verified_absent" };
    }

    // Check id match first
    if (observed.id !== schedulerId) {
      await appendEvidence({ status: "intervention_required", reason: "mismatch" });
      return { status: "intervention_required", reason: "id mismatch" };
    }

    // Check disabled schedule content
    if (!verifyDisabledSchedule(storedPlan, observed)) {
      if (observed.enabled === true) {
        await appendEvidence({ status: "intervention_required", reason: "enabled" });
        return { status: "intervention_required", reason: "enabled" };
      }
      await appendEvidence({ status: "intervention_required", reason: "mismatch" });
      return { status: "intervention_required", reason: "content mismatch" };
    }

    // Exact match: safe to remove
    try {
      await scheduler.remove(schedulerId);
    } catch {
      // Remove rejected: unknown cleanup outcome
      await appendEvidence({ status: "cleanup_unknown", reason: "remove_failed" });
      return { status: "cleanup_unknown", reason: "scheduler remove failed" };
    }

    // Read back to prove removal: only null proves it
    let postRemove;
    try {
      postRemove = await scheduler.read(schedulerId);
    } catch {
      await appendEvidence({ status: "cleanup_unknown", reason: "post_remove_read_failed" });
      return { status: "cleanup_unknown", reason: "cannot verify removal" };
    }

    if (postRemove === null) {
      await appendEvidence({ status: "cleaned_up", detail: "job removed and verified absent" });
      return { status: "cleaned_up" };
    }

    // Still present after remove
    await appendEvidence({ status: "cleanup_failed", reason: "job still present after remove" });
    return { status: "cleanup_failed" };
  } finally {
    // Release the lock only if this call created it
    if (createdLock) {
      try { await rmdir(lockDir); } catch { /* best effort */ }
    }
  }
}
