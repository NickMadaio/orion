import { createHash } from "node:crypto";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile, rename, stat, constants } from "node:fs/promises";
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
 * @param {{
 *   root: string,
 *   proposal: object,
 *   timeZone: string,
 *   repoRoot: string,
 *   scheduler: { createDisabled(plan): Promise<{id: string}>, read(id): Promise<object>, remove(id): Promise<void> },
 *   now: Date
 * }} params
 * @returns {Promise<object>} verified disabled state or error classification
 */
export async function installDisabledAutomation({ root, proposal, timeZone, repoRoot, scheduler, now }) {
  // --- validate inputs: all roots and scheduler adapter required ---
  if (!root || typeof root !== "string") throw new TypeError("root is required");
  if (!proposal || typeof proposal !== "object") throw new TypeError("proposal is required");
  if (!timeZone || typeof timeZone !== "string") throw new TypeError("timeZone is required");
  if (!repoRoot || typeof repoRoot !== "string") throw new TypeError("repoRoot is required");
  if (!scheduler || typeof scheduler.createDisabled !== "function" ||
      typeof scheduler.read !== "function" || typeof scheduler.remove !== "function") {
    throw new TypeError("scheduler adapter must expose createDisabled, read, remove");
  }
  if (!(now instanceof Date)) throw new TypeError("now must be a Date");

  // --- build schedule plan ---
  const { automationSchedulePlan } = await import("./orion-automation-schedule.mjs");
  const plan = automationSchedulePlan(proposal, timeZone, repoRoot, now);

  // --- assemble installed record ---
  const installationId = randomBytes(16).toString("hex");
  const bareName = proposal.name;
  const installedAt = now.toISOString();

  const installedRecord = {
    name: bareName,
    installationId,
    installedAt,
    timeZone,
    trigger: proposal.trigger,
    policy: plan.policy,
  };

  // --- transaction tracking ---
  const txDir = join(root, "transactions");
  const txFile = join(txDir, `${bareName}.json`);
  const lockDir = join(txDir, `${bareName}.lock`);

  let phase = "before_create";
  let evidence = {};

  async function persistTransaction() {
    await mkdir(txDir, { recursive: true });
    const data = JSON.stringify({ phase, evidence, installationId }, null, 2);
    const tmpFile = join(txDir, `${bareName}.${randomBytes(8).toString("hex")}.tmp`);
    await writeFile(tmpFile, data, { mode: 0o600 });
    await rename(tmpFile, txFile);
    // fsync directory for durability
    const dirFd = await import("node:fs/promises").then(m => m.open(txDir, constants.O_RDONLY));
    try { await dirFd.fdatasync(); } catch { /* best effort */ }
    finally { await dirFd.close(); }
  }

  // --- exclusive per-name intent: refuse existing installation, ledger, or active transaction ---
  try {
    await mkdir(lockDir, { recursive: false });
  } catch (err) {
    if (err.code === "EEXIST") {
      // Check for pre-existing installed record
      const installedPath = join(root, "installed", `${bareName}.json`);
      try {
        await stat(installedPath);
        return { status: "already_installed", reason: `installation ${bareName} already exists`, phase };
      } catch { /* no existing record */ }

      // Check for active/uncertain transaction
      try {
        const existing = JSON.parse(await import("node:fs/promises").then(m => m.readFile(txFile, "utf8")));
        if (existing.phase && !["complete", "publication_failed"].includes(existing.phase)) {
          return { status: "transaction_active", reason: `uncertain transaction in phase ${existing.phase}`, phase };
        }
      } catch { /* no existing transaction */ }

      // Concurrent same-name call — refuse without overwriting
      return { status: "concurrent_refused", reason: "another installation holds the lock", phase };
    }
    throw err;
  }

  // --- persist transaction intent before any scheduler effect ---
  try {
    await persistTransaction();
  } catch (err) {
    evidence.tx_write_error = err.message;
    return { status: "no_effect", reason: "failed to persist transaction intent", phase, evidence };
  }

  // --- create disabled job on scheduler ---
  let jobId;
  try {
    const result = await scheduler.createDisabled(plan);
    jobId = result.id;
    evidence.scheduler_id = jobId;
  } catch (err) {
    phase = "create_pending";
    evidence.create_error = err.message;
    await persistTransaction();
    return { status: "unknown_outcome", reason: "scheduler create failed, outcome uncertain", phase, evidence };
  }

  // --- read back and verify disabled state ---
  let observed;
  try {
    observed = await scheduler.read(jobId);
  } catch (err) {
    phase = "create_pending";
    evidence.read_error = err.message;
    await persistTransaction();
    return { status: "unknown_outcome", reason: "scheduler read failed after create", phase, evidence };
  }

  if (!verifyDisabledSchedule(plan, observed)) {
    phase = "job_known";
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
    const installedDir = join(root, "installed");
    await mkdir(installedDir, { recursive: true });
    const installedPath = join(installedDir, `${bareName}.json`);
    const data = JSON.stringify(installedRecord, null, 2);
    const tmpFile = join(installedDir, `${bareName}.${randomBytes(8).toString("hex")}.tmp`);
    await writeFile(tmpFile, data, { mode: 0o600 });
    await rename(tmpFile, installedPath);

    // fsync directory for durability
    const dirFd = await import("node:fs/promises").then(m => m.open(installedDir, constants.O_RDONLY));
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
    installationId,
    schedulerId: jobId,
    installedRecord,
    phase,
    evidence,
  };
}
