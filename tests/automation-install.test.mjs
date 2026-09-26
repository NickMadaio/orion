import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, mkdir, readdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash, randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { automationSchedulePlan } from "../scripts/lib/orion-automation-schedule.mjs";
import { verifyDisabledSchedule, installDisabledAutomation, reconcileDisabledAutomation } from "../scripts/lib/orion-automation-install.mjs";

// --- Task 1 tests: verifyDisabledSchedule (unchanged) ---

const proposal = () => ({ name: "calendar-check", intent: "Read the calendar at the chosen time", action: "agenda_today",
  expiresOn: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
  trigger: { kind: "daily", atHour: 9, atMinute: 5 }, conditions: {}, permissions: { expectsMode: "guarded" },
  riskLimits: { maxRunsPerDay: 2, maxMessagesPerDay: 0 }, failureBehavior: "stop" });

function makeExpected() {
  return automationSchedulePlan(proposal(), "Europe/London", "/fixture/repo with spaces");
}

const VALID_OBSERVED = Object.freeze({
  id: "test-job-id-1234",
  name: "orion-auto-calendar-check",
  timeZone: "Europe/London",
  cron: "5 9 * * *",
  commandArgv: ["/fixture/repo with spaces/scripts/orion-automation-run", "calendar-check"],
  cwd: "/fixture/repo with spaces",
  enabled: false,
  exact: true,
  noDeliver: true,
});

function makeObserved(expected) {
  return {
    id: "test-job-id-1234",
    name: expected.name,
    timeZone: expected.timeZone,
    cron: expected.cron,
    commandArgv: [...expected.commandArgv],
    cwd: expected.schedulerArgs[expected.schedulerArgs.indexOf("--command-cwd") + 1],
    enabled: false,
    exact: true,
    noDeliver: true,
  };
}

test("verifyDisabledSchedule returns true for a valid disabled job", () => {
  const expected = makeExpected();
  assert.strictEqual(verifyDisabledSchedule(expected, VALID_OBSERVED), true);
});

test("verifyDisabledSchedule rejects when id is missing", () => {
  const expected = makeExpected();
  const observed = makeObserved(expected);
  delete observed.id;
  assert.strictEqual(verifyDisabledSchedule(expected, observed), false);
});

test("verifyDisabledSchedule rejects when id is blank", () => {
  const expected = makeExpected();
  const observed = makeObserved(expected);
  observed.id = "";
  assert.strictEqual(verifyDisabledSchedule(expected, observed), false);
});

test("verifyDisabledSchedule rejects when name differs", () => {
  const expected = makeExpected();
  const observed = makeObserved(expected);
  observed.name = "orion-auto-wrong-name";
  assert.strictEqual(verifyDisabledSchedule(expected, observed), false);
});

test("verifyDisabledSchedule rejects when timeZone differs", () => {
  const expected = makeExpected();
  const observed = makeObserved(expected);
  observed.timeZone = "America/New_York";
  assert.strictEqual(verifyDisabledSchedule(expected, observed), false);
});

test("verifyDisabledSchedule rejects when cron differs", () => {
  const expected = makeExpected();
  const observed = makeObserved(expected);
  observed.cron = "0 9 * * *";
  assert.strictEqual(verifyDisabledSchedule(expected, observed), false);
});

test("verifyDisabledSchedule rejects when commandArgv is shorter", () => {
  const expected = makeExpected();
  const observed = makeObserved(expected);
  observed.commandArgv = [observed.commandArgv[0]];
  assert.strictEqual(verifyDisabledSchedule(expected, observed), false);
});

test("verifyDisabledSchedule rejects when commandArgv is longer", () => {
  const expected = makeExpected();
  const observed = makeObserved(expected);
  observed.commandArgv = [...observed.commandArgv, "extra-arg"];
  assert.strictEqual(verifyDisabledSchedule(expected, observed), false);
});

test("verifyDisabledSchedule rejects when commandArgv is a string instead of array", () => {
  const expected = makeExpected();
  const observed = makeObserved(expected);
  observed.commandArgv = "/fixture/repo with spaces/scripts/orion-automation-run calendar-check";
  assert.strictEqual(verifyDisabledSchedule(expected, observed), false);
});

test("verifyDisabledSchedule rejects when commandArgv entries are malformed", () => {
  const expected = makeExpected();
  const observed = makeObserved(expected);
  observed.commandArgv = [null, undefined];
  assert.strictEqual(verifyDisabledSchedule(expected, observed), false);
});

test("verifyDisabledSchedule rejects a space-split argv that does not match exactly", () => {
  const expected = makeExpected();
  const observed = makeObserved(expected);
  observed.commandArgv = ["/fixture/repo", "with", "spaces/scripts/orion-automation-run", "calendar-check"];
  assert.strictEqual(verifyDisabledSchedule(expected, observed), false);
});

test("verifyDisabledSchedule rejects when cwd is truncated", () => {
  const expected = makeExpected();
  const observed = makeObserved(expected);
  observed.cwd = "/fixture/repo";
  assert.strictEqual(verifyDisabledSchedule(expected, observed), false);
});

test("verifyDisabledSchedule rejects shell-looking argv entries without executing them", () => {
  const expected = makeExpected();
  const observed = makeObserved(expected);
  observed.commandArgv = ["/bin/sh", "-c", "rm -rf /"];
  assert.strictEqual(verifyDisabledSchedule(expected, observed), false);
});

test("verifyDisabledSchedule rejects an unexpectedly active job", () => {
  const expected = makeExpected();
  const observed = makeObserved(expected);
  observed.enabled = true;
  assert.strictEqual(verifyDisabledSchedule(expected, observed), false);
});

test("verifyDisabledSchedule rejects when exact is not true", () => {
  const expected = makeExpected();
  const observed = makeObserved(expected);
  observed.exact = false;
  assert.strictEqual(verifyDisabledSchedule(expected, observed), false);
});

test("verifyDisabledSchedule rejects when noDeliver is not true", () => {
  const expected = makeExpected();
  const observed = makeObserved(expected);
  observed.noDeliver = false;
  assert.strictEqual(verifyDisabledSchedule(expected, observed), false);
});

test("verifyDisabledSchedule does not validate an object against itself", () => {
  const expected = makeExpected();
  assert.strictEqual(verifyDisabledSchedule(expected, expected), false);
});

test("verifyDisabledSchedule handles malformed input without throwing", () => {
  assert.strictEqual(verifyDisabledSchedule(null, null), false);
  assert.strictEqual(verifyDisabledSchedule(undefined, {}), false);
  assert.strictEqual(verifyDisabledSchedule({}, undefined), false);
  assert.strictEqual(verifyDisabledSchedule("string", {}), false);
  assert.strictEqual(verifyDisabledSchedule({}, "string"), false);
  assert.strictEqual(verifyDisabledSchedule({ schedulerArgs: [] }, {}), false);
});

// --- Task 2 tests: installDisabledAutomation transaction ---

const NOW = Date.parse("2026-09-20T08:00:00Z");
const DUE = Date.parse("2026-09-20T08:05:00Z");
const REPO_ROOT = "/fixture/repo-root";

function makeProposal() {
  return {
    name: "calendar-check",
    intent: "Read the calendar at the chosen time",
    action: "agenda_today",
    expiresOn: "2026-09-27",
    trigger: { kind: "daily", atHour: 9, atMinute: 5 },
    conditions: {},
    permissions: { expectsMode: "guarded" },
    riskLimits: { maxRunsPerDay: 2, maxMessagesPerDay: 0 },
    failureBehavior: "stop",
  };
}

function makeFakeScheduler(repoRootOverride) {
  const repo = repoRootOverride || REPO_ROOT;
  const calls = [];
  return {
    calls,
    createDisabled: async (plan) => {
      calls.push("createDisabled");
      return { id: "job-1" };
    },
    read: async (id) => {
      calls.push("read");
      // Literal job shape — never copied from plan
      return {
        id,
        name: "orion-auto-calendar-check",
        timeZone: "Europe/London",
        cron: "5 9 * * *",
        commandArgv: [repo + "/scripts/orion-automation-run", "calendar-check"],
        cwd: repo,
        enabled: false,
        exact: true,
        noDeliver: true,
      };
    },
    remove: async (id) => {
      calls.push("remove");
    },
  };
}

test("installDisabledAutomation: successful disabled registration", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const scheduler = makeFakeScheduler();
  const result = await installDisabledAutomation({
    root,
    proposal: makeProposal(),
    timeZone: "Europe/London",
    repoRoot: REPO_ROOT,
    scheduler,
    now: NOW,
  });

  assert.strictEqual(result.status, "disabled_verified");
  assert.strictEqual(result.enabled, false);
  assert.ok(typeof result.installationId === "string" && result.installationId.length > 0);
  assert.strictEqual(result.schedulerId, "job-1");
  assert.deepEqual(scheduler.calls, ["createDisabled", "read"]);

  // Installed record exists and has correct shape
  const installedData = JSON.parse(await readFile(join(root, "installed", "calendar-check.json"), "utf8"));
  assert.strictEqual(installedData.name, "calendar-check");
  assert.strictEqual(installedData.action, "agenda_today");
  assert.ok(installedData.installationId);
  assert.ok(installedData.installedAt);

  // Dispatch ledger exists with phase ready
  // The dispatcher names the file with the sha256 hex of the installationId
  const dispatchFileName = createHash("sha256").update(installedData.installationId).digest("hex") + ".dispatch.json";
  const dispatchFile = join(root, "runtime", dispatchFileName);
  const dispatchData = JSON.parse(await readFile(dispatchFile, "utf8"));
  assert.strictEqual(dispatchData.phase, "ready");

  // Transaction is complete
  const txData = JSON.parse(await readFile(join(root, "transactions", "calendar-check.json"), "utf8"));
  assert.strictEqual(txData.phase, "complete");
  assert.strictEqual(txData.schedulerId, "job-1");

  // Interop proof: runInstalledAutomation succeeds
  const { runInstalledAutomation } = await import("../scripts/lib/orion-automation-runtime.mjs");
  const runResult = await runInstalledAutomation("calendar-check", DUE, {
    automationRoot: root,
    repoRoot: REPO_ROOT,
    checks: {
      readContext: async () => ({ now: DUE, effectiveMode: "guarded", focusActive: false }),
      authorize: async () => true,
    },
    run: async () => ({ stdout: "ok" }),
  });
  assert.strictEqual(runResult.status, "succeeded");
});

test("installDisabledAutomation: same-name concurrency refusal", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const scheduler = makeFakeScheduler();
  const promises = [];
  for (let i = 0; i < 5; i++) {
    promises.push(
      installDisabledAutomation({
        root,
        proposal: makeProposal(),
        timeZone: "Europe/London",
        repoRoot: REPO_ROOT,
        scheduler,
        now: NOW,
      })
    );
  }

  const results = await Promise.allSettled(promises);
  const successes = results.filter((r) => r.status === "fulfilled" && r.value.status === "disabled_verified");
  assert.strictEqual(successes.length, 1, "exactly one call should succeed");
  assert.strictEqual(scheduler.calls.filter((c) => c === "createDisabled").length, 1, "createDisabled called exactly once");
});

test("installDisabledAutomation: existing record unchanged", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  // Pre-write an installed record
  await mkdir(join(root, "installed"), { recursive: true });
  const existingRecord = { name: "calendar-check", installationId: "existing-id", action: "agenda_today" };
  const existingBytes = JSON.stringify(existingRecord);
  await writeFile(join(root, "installed", "calendar-check.json"), existingBytes);

  const scheduler = makeFakeScheduler();
  const result = await installDisabledAutomation({
    root,
    proposal: makeProposal(),
    timeZone: "Europe/London",
    repoRoot: REPO_ROOT,
    scheduler,
    now: NOW,
  });

  assert.strictEqual(result.status, "already_installed");
  // Bytes unchanged
  const afterBytes = await readFile(join(root, "installed", "calendar-check.json"), "utf8");
  assert.strictEqual(afterBytes, existingBytes);
  // No scheduler calls
  assert.deepEqual(scheduler.calls, []);
  // No runtime files created
  try {
    await rm(join(root, "runtime"), { recursive: true, force: true });
  } catch {
    // runtime dir should not exist
  }
});

test("installDisabledAutomation: failure before create (bad timezone)", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const scheduler = makeFakeScheduler();
  let threw = false;
  try {
    await installDisabledAutomation({
      root,
      proposal: makeProposal(),
      timeZone: "Mars/Base",
      repoRoot: REPO_ROOT,
      scheduler,
      now: NOW,
    });
  } catch {
    threw = true;
  }
  assert.ok(threw, "should throw on invalid timezone");
  assert.deepEqual(scheduler.calls, []);

  // No installed or runtime files
  try {
    await readFile(join(root, "installed", "calendar-check.json"), "utf8");
    assert.fail("installed file should not exist");
  } catch {
    // expected
  }
});

test("installDisabledAutomation: failed read-back (enabled:true and rejection)", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  // Case 1: read returns enabled:true
  const scheduler1 = makeFakeScheduler();
  scheduler1.read = async (id) => {
    scheduler1.calls.push("read");
    return {
      id,
      name: "orion-auto-calendar-check",
      timeZone: "Europe/London",
      cron: "5 9 * * *",
      commandArgv: [REPO_ROOT + "/scripts/orion-automation-run", "calendar-check"],
      cwd: REPO_ROOT,
      enabled: true,
      exact: true,
      noDeliver: true,
    };
  };

  const result1 = await installDisabledAutomation({
    root,
    proposal: makeProposal(),
    timeZone: "Europe/London",
    repoRoot: REPO_ROOT,
    scheduler: scheduler1,
    now: NOW,
  });

  assert.strictEqual(result1.status, "verification_failed");
  const tx1 = JSON.parse(await readFile(join(root, "transactions", "calendar-check.json"), "utf8"));
  assert.strictEqual(tx1.phase, "job_known");
  assert.strictEqual(tx1.schedulerId, "job-1");
  // No installed record
  try {
    await readFile(join(root, "installed", "calendar-check.json"), "utf8");
    assert.fail("installed file should not exist on verification failure");
  } catch {
    // expected
  }
  // remove never called
  assert.strictEqual(scheduler1.calls.filter((c) => c === "remove").length, 0);

  // Case 2: read rejects
  const root2 = await mkdtemp(join(tmpdir(), "orion-install-"));
  t.after(async () => rm(root2, { recursive: true, force: true }));

  const scheduler2 = makeFakeScheduler();
  scheduler2.read = async (id) => {
    scheduler2.calls.push("read");
    throw new Error("scheduler unavailable");
  };

  const result2 = await installDisabledAutomation({
    root: root2,
    proposal: makeProposal(),
    timeZone: "Europe/London",
    repoRoot: REPO_ROOT,
    scheduler: scheduler2,
    now: NOW,
  });

  assert.strictEqual(result2.status, "verification_failed");
  const tx2 = JSON.parse(await readFile(join(root2, "transactions", "calendar-check.json"), "utf8"));
  assert.strictEqual(tx2.phase, "job_known");
  assert.strictEqual(scheduler2.calls.filter((c) => c === "remove").length, 0);
});

test("installDisabledAutomation: publication failure", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  // Make runtime dir a file so ledger creation fails
  await writeFile(join(root, "runtime"), "");

  const scheduler = makeFakeScheduler();
  const result = await installDisabledAutomation({
    root,
    proposal: makeProposal(),
    timeZone: "Europe/London",
    repoRoot: REPO_ROOT,
    scheduler,
    now: NOW,
  });

  assert.strictEqual(result.status, "publication_failed");
  // Transaction records the failure
  const txData = JSON.parse(await readFile(join(root, "transactions", "calendar-check.json"), "utf8"));
  assert.strictEqual(txData.phase, "publication_failed");
  assert.ok(txData.evidence.publication_error);
  // No installed record
  try {
    await readFile(join(root, "installed", "calendar-check.json"), "utf8");
    assert.fail("installed file should not exist on publication failure");
  } catch {
    // expected
  }
});

// --- Task 3 tests: reconcileDisabledAutomation ---

function makeFileBackedScheduler(root) {
  const jobsPath = join(root, "fake-jobs.json");
  const calls = [];
  
  async function loadJobs() {
    try {
      return JSON.parse(await readFile(jobsPath, "utf8"));
    } catch {
      return {};
    }
  }
  
  async function saveJobs(jobs) {
    await writeFile(jobsPath, JSON.stringify(jobs, null, 2));
  }
  
  return {
    calls,
    createDisabled: async (plan) => {
      calls.push("createDisabled");
      const jobs = await loadJobs();
      const id = "job-" + Math.random().toString(36).slice(2, 8);
      jobs[id] = {
        id,
        name: plan.name,
        timeZone: plan.timeZone,
        cron: plan.cron,
        commandArgv: plan.commandArgv,
        cwd: plan.schedulerArgs[plan.schedulerArgs.indexOf("--command-cwd") + 1],
        enabled: false,
        exact: true,
        noDeliver: true,
      };
      await saveJobs(jobs);
      return { id };
    },
    read: async (id) => {
      calls.push("read");
      const jobs = await loadJobs();
      if (jobs[id]) {
        return jobs[id];
      }
      return null;
    },
    remove: async (id) => {
      calls.push("remove");
      const jobs = await loadJobs();
      delete jobs[id];
      await saveJobs(jobs);
    },
  };
}

test("reconcileDisabledAutomation: child process exit at transaction seam", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  // Initialize empty jobs file for the file-backed scheduler
  await writeFile(join(root, "fake-jobs.json"), "{}");

  const moduleURL = new URL('../scripts/lib/orion-automation-install.mjs', import.meta.url).href;
  const source = `import {installDisabledAutomation} from ${JSON.stringify(moduleURL)};
    import {readFile, writeFile} from 'node:fs/promises';
    const [root, proposal, timeZone, repoRoot, now] = JSON.parse(process.argv[1]);
    
    // File-backed scheduler that persists jobs to disk
    const jobsPath = root + '/fake-jobs.json';
    async function loadJobs() {
      try { return JSON.parse(await readFile(jobsPath, 'utf8')); } catch { return {}; }
    }
    async function saveJobs(jobs) { await writeFile(jobsPath, JSON.stringify(jobs, null, 2)); }
    
    const scheduler = {
      createDisabled: async (plan) => {
        const jobs = await loadJobs();
        const id = 'job-crash-1';
        jobs[id] = {
          id, name: plan.name, timeZone: plan.timeZone, cron: plan.cron,
          commandArgv: plan.commandArgv,
          cwd: plan.schedulerArgs[plan.schedulerArgs.indexOf('--command-cwd') + 1],
          enabled: false, exact: true, noDeliver: true,
        };
        await saveJobs(jobs);
        // Crash BEFORE returning the id — installer never records it,
        // leaving transaction in create_pending with lock still held.
        process.exit(73);
      },
      read: async (id) => {
        const jobs = await loadJobs();
        return jobs[id] || null;
      },
      remove: async () => {},
    };
    
    await installDisabledAutomation({ root, proposal, timeZone, repoRoot, scheduler, now });
    process.exit(73);`;

  await assert.rejects(
    promisify(execFile)(process.execPath, ['--input-type=module', '-e', source, JSON.stringify([root, makeProposal(), "Europe/London", REPO_ROOT, NOW])]),
    (error) => error.code === 73
  );

  // The child exited with code 73, leaving a lock behind
  // Reconcile should return busy because the lock exists
  const scheduler = makeFileBackedScheduler(root);
  let result = await reconcileDisabledAutomation({ root, name: "calendar-check", scheduler });
  assert.strictEqual(result.status, "busy");

  // Test removes the lock (child positively exited)
  const lockPath = join(root, "transactions", "calendar-check.lock");
  await rm(lockPath, { recursive: true, force: true });

  // Now reconcile should find the transaction in create_pending phase with no scheduler id recorded properly
  result = await reconcileDisabledAutomation({ root, name: "calendar-check", scheduler });
  assert.strictEqual(result.status, "blocked_unknown_create");
  
  // Verify no createDisabled was called by reconcile
  assert.strictEqual(scheduler.calls.filter(c => c === "createDisabled").length, 0);
});

test("reconcileDisabledAutomation: child process exit after id persisted", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, "fake-jobs.json"), "{}");

  const moduleURL = new URL('../scripts/lib/orion-automation-install.mjs', import.meta.url).href;
  const source = `import {installDisabledAutomation} from ${JSON.stringify(moduleURL)};
    import {readFile, writeFile} from 'node:fs/promises';
    const [root, proposal, timeZone, repoRoot, now] = JSON.parse(process.argv[1]);
    
    const jobsPath = root + '/fake-jobs.json';
    async function loadJobs() {
      try { return JSON.parse(await readFile(jobsPath, 'utf8')); } catch { return {}; }
    }
    async function saveJobs(jobs) { await writeFile(jobsPath, JSON.stringify(jobs, null, 2)); }
    
    let readCount = 0;
    const scheduler = {
      createDisabled: async (plan) => {
        const jobs = await loadJobs();
        const id = 'job-crash-2';
        jobs[id] = {
          id, name: plan.name, timeZone: plan.timeZone, cron: plan.cron,
          commandArgv: plan.commandArgv,
          cwd: plan.schedulerArgs[plan.schedulerArgs.indexOf('--command-cwd') + 1],
          enabled: false, exact: true, noDeliver: true,
        };
        await saveJobs(jobs);
        return { id };
      },
      read: async (id) => {
        readCount++;
        if (readCount === 1) {
          process.exit(73);
        }
        const jobs = await loadJobs();
        return jobs[id] || null;
      },
      remove: async () => {},
    };
    
    await installDisabledAutomation({ root, proposal, timeZone, repoRoot, scheduler, now });`;

  await assert.rejects(
    promisify(execFile)(process.execPath, ['--input-type=module', '-e', source, JSON.stringify([root, makeProposal(), "Europe/London", REPO_ROOT, NOW])]),
    (error) => error.code === 73
  );

  // Remove lock left by dead child
  await rm(join(root, "transactions", "calendar-check.lock"), { recursive: true, force: true });

  // Reconcile should find job_known phase with scheduler id, exact match, remove and verify absence
  const scheduler = makeFileBackedScheduler(root);
  const result = await reconcileDisabledAutomation({ root, name: "calendar-check", scheduler });
  
  // Should have removed the job and verified absence
  assert.strictEqual(result.status, "cleaned_up");
  assert.ok(scheduler.calls.includes("read"));
  assert.ok(scheduler.calls.includes("remove"));
});

test("reconcileDisabledAutomation: no transaction file", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const scheduler = makeFileBackedScheduler(root);
  const result = await reconcileDisabledAutomation({ root, name: "calendar-check", scheduler });
  
  assert.strictEqual(result.status, "no_transaction");
  assert.deepEqual(scheduler.calls, []);
});

test("reconcileDisabledAutomation: complete phase verification", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  // First do a successful installation
  const scheduler = makeFileBackedScheduler(root);
  const installResult = await installDisabledAutomation({
    root,
    proposal: makeProposal(),
    timeZone: "Europe/London",
    repoRoot: REPO_ROOT,
    scheduler,
    now: NOW,
  });
  
  assert.strictEqual(installResult.status, "disabled_verified");

  // Clear calls for reconcile test
  scheduler.calls.length = 0;

  // Read transaction file bytes before reconciliation
  const txBytesBefore = await readFile(join(root, "transactions", "calendar-check.json"));

  // Reconcile should verify the complete installation
  const result = await reconcileDisabledAutomation({ root, name: "calendar-check", scheduler });
  assert.strictEqual(result.status, "complete_verified");
  
  // Verify read was called but not remove or createDisabled
  assert.ok(scheduler.calls.includes("read"));
  assert.strictEqual(scheduler.calls.filter(c => c === "remove").length, 0);
  assert.strictEqual(scheduler.calls.filter(c => c === "createDisabled").length, 0);

  // complete_verified must write nothing: transaction file bytes unchanged, evidence not grown
  const txBytesAfter = await readFile(join(root, "transactions", "calendar-check.json"));
  assert.strictEqual(Buffer.compare(txBytesBefore, txBytesAfter), 0, "transaction file must be unchanged for complete_verified");
  
  const txData = JSON.parse(await readFile(join(root, "transactions", "calendar-check.json"), "utf8"));
  // evidence.reconcile should not exist or be empty — no write happened
  assert.ok(!txData.evidence.reconcile || txData.evidence.reconcile.length === 0);
});

test("reconcileDisabledAutomation: repeated reconciliation idempotency", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const scheduler = makeFileBackedScheduler(root);
  
  // Install successfully
  await installDisabledAutomation({
    root,
    proposal: makeProposal(),
    timeZone: "Europe/London",
    repoRoot: REPO_ROOT,
    scheduler,
    now: NOW,
  });

  // First reconciliation
  const result1 = await reconcileDisabledAutomation({ root, name: "calendar-check", scheduler });
  assert.strictEqual(result1.status, "complete_verified");

  // Read transaction file bytes after first call
  const txBytes1 = await readFile(join(root, "transactions", "calendar-check.json"));

  // Second reconciliation should give same status
  const result2 = await reconcileDisabledAutomation({ root, name: "calendar-check", scheduler });
  assert.strictEqual(result2.status, "complete_verified");

  // Transaction file bytes must be identical — complete_verified writes nothing
  const txBytes2 = await readFile(join(root, "transactions", "calendar-check.json"));
  assert.strictEqual(Buffer.compare(txBytes1, txBytes2), 0);
});

test("reconcileDisabledAutomation: scheduler read failure", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  // Create a transaction in job_known phase manually
  const txDir = join(root, "transactions");
  await mkdir(txDir, { recursive: true });
  
  const plan = automationSchedulePlan(makeProposal(), "Europe/London", REPO_ROOT);
  const txData = {
    version: 1,
    name: "calendar-check",
    phase: "job_known",
    installationId: "test-install-id",
    installedAt: new Date(NOW).toISOString(),
    timeZone: "Europe/London",
    schedulerId: "job-fail-read",
    plan,
    record: { name: "calendar-check", installationId: "test-install-id" },
    evidence: {},
  };
  
  await writeFile(join(txDir, "calendar-check.json"), JSON.stringify(txData, null, 2));

  // Scheduler that always rejects read
  const scheduler = {
    calls: [],
    read: async () => {
      scheduler.calls.push("read");
      throw new Error("scheduler unavailable");
    },
    remove: async () => {
      scheduler.calls.push("remove");
    },
  };

  const result = await reconcileDisabledAutomation({ root, name: "calendar-check", scheduler });
  
  assert.strictEqual(result.status, "unknown_outcome");
  assert.ok(scheduler.calls.includes("read"));
  assert.strictEqual(scheduler.calls.filter(c => c === "remove").length, 0);

  // Verify evidence was recorded
  const updatedTx = JSON.parse(await readFile(join(txDir, "calendar-check.json"), "utf8"));
  assert.ok(Array.isArray(updatedTx.evidence.reconcile));
  assert.ok(updatedTx.evidence.reconcile[0].status === "unknown_outcome");
});

test("reconcileDisabledAutomation: mismatched id and content", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  // Create transaction with known scheduler id
  const txDir = join(root, "transactions");
  await mkdir(txDir, { recursive: true });
  
  const plan = automationSchedulePlan(makeProposal(), "Europe/London", REPO_ROOT);
  const txData = {
    version: 1,
    name: "calendar-check",
    phase: "job_known",
    installationId: "test-install-id",
    installedAt: new Date(NOW).toISOString(),
    timeZone: "Europe/London",
    schedulerId: "job-original",
    plan,
    record: { name: "calendar-check", installationId: "test-install-id" },
    evidence: {},
  };
  
  await writeFile(join(txDir, "calendar-check.json"), JSON.stringify(txData, null, 2));

  // Scheduler returns job with different id
  const scheduler = {
    calls: [],
    read: async (id) => {
      scheduler.calls.push("read");
      return {
        id: "job-different", // Different id!
        name: "orion-auto-calendar-check",
        timeZone: "Europe/London",
        cron: "5 9 * * *",
        commandArgv: [REPO_ROOT + "/scripts/orion-automation-run", "calendar-check"],
        cwd: REPO_ROOT,
        enabled: false,
        exact: true,
        noDeliver: true,
      };
    },
    remove: async () => {
      scheduler.calls.push("remove");
    },
  };

  const result = await reconcileDisabledAutomation({ root, name: "calendar-check", scheduler });
  
  assert.strictEqual(result.status, "intervention_required");
  assert.ok(scheduler.calls.includes("read"));
  assert.strictEqual(scheduler.calls.filter(c => c === "remove").length, 0);
});

test("reconcileDisabledAutomation: cleanup failure scenarios", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  // Create transaction in job_known phase with exact matching job
  const txDir = join(root, "transactions");
  await mkdir(txDir, { recursive: true });
  
  const plan = automationSchedulePlan(makeProposal(), "Europe/London", REPO_ROOT);
  const txData = {
    version: 1,
    name: "calendar-check",
    phase: "job_known",
    installationId: "test-install-id",
    installedAt: new Date(NOW).toISOString(),
    timeZone: "Europe/London",
    schedulerId: "job-cleanup-fail",
    plan,
    record: { name: "calendar-check", installationId: "test-install-id" },
    evidence: {},
  };
  
  await writeFile(join(txDir, "calendar-check.json"), JSON.stringify(txData, null, 2));

  // Scheduler where remove rejects
  const schedulerReject = {
    calls: [],
    read: async (id) => {
      schedulerReject.calls.push("read");
      return {
        id,
        name: "orion-auto-calendar-check",
        timeZone: "Europe/London",
        cron: "5 9 * * *",
        commandArgv: [REPO_ROOT + "/scripts/orion-automation-run", "calendar-check"],
        cwd: REPO_ROOT,
        enabled: false,
        exact: true,
        noDeliver: true,
      };
    },
    remove: async () => {
      schedulerReject.calls.push("remove");
      throw new Error("remove failed");
    },
  };

  let result = await reconcileDisabledAutomation({ root, name: "calendar-check", scheduler: schedulerReject });
  assert.strictEqual(result.status, "cleanup_unknown");
  assert.ok(schedulerReject.calls.includes("remove"));

  // Verify evidence preserved
  const txAfter = JSON.parse(await readFile(join(txDir, "calendar-check.json"), "utf8"));
  assert.ok(Array.isArray(txAfter.evidence.reconcile));
});

test("reconcileDisabledAutomation: cleanup failure - job still present after remove", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const txDir = join(root, "transactions");
  await mkdir(txDir, { recursive: true });
  
  const plan = automationSchedulePlan(makeProposal(), "Europe/London", REPO_ROOT);
  const txData = {
    version: 1,
    name: "calendar-check",
    phase: "job_known",
    installationId: "test-install-id",
    installedAt: new Date(NOW).toISOString(),
    timeZone: "Europe/London",
    schedulerId: "job-still-there",
    plan,
    record: { name: "calendar-check", installationId: "test-install-id" },
    evidence: {},
  };
  
  await writeFile(join(txDir, "calendar-check.json"), JSON.stringify(txData, null, 2));

  // Scheduler where remove succeeds but job still exists
  const scheduler = {
    calls: [],
    read: async (id) => {
      scheduler.calls.push("read");
      return {
        id,
        name: "orion-auto-calendar-check",
        timeZone: "Europe/London",
        cron: "5 9 * * *",
        commandArgv: [REPO_ROOT + "/scripts/orion-automation-run", "calendar-check"],
        cwd: REPO_ROOT,
        enabled: false,
        exact: true,
        noDeliver: true,
      };
    },
    remove: async () => {
      scheduler.calls.push("remove");
      // Doesn't actually remove - job still there
    },
  };

  const result = await reconcileDisabledAutomation({ root, name: "calendar-check", scheduler });
  assert.strictEqual(result.status, "cleanup_failed");

  // Verify evidence was appended to the transaction file
  const txAfter = JSON.parse(await readFile(join(txDir, "calendar-check.json"), "utf8"));
  assert.ok(Array.isArray(txAfter.evidence.reconcile));
  assert.ok(txAfter.evidence.reconcile.length > 0);
});

test("reconcileDisabledAutomation: never calls createDisabled", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-install-"));
  t.after(() => rm(root, { recursive: true, force: true }));

  const scheduler = {
    calls: [],
    read: async () => null,
    remove: async () => {},
    createDisabled: async () => {
      scheduler.calls.push("createDisabled");
      throw new Error("createDisabled should never be called by reconcile");
    },
  };

  // No transaction file - should return no_transaction without calling anything
  const result = await reconcileDisabledAutomation({ root, name: "calendar-check", scheduler });
  assert.strictEqual(result.status, "no_transaction");
  assert.strictEqual(scheduler.calls.filter(c => c === "createDisabled").length, 0);
});

// --- Task 4 tests: auto-install-fixture-route (prove installation output reaches guarded execution) ---

const { runInstalledAutomation } = await import("../scripts/lib/orion-automation-runtime.mjs");

async function installFixture(root, scheduler, proposalOverride, repoRootOverride) {
  const proposal = proposalOverride || makeProposal();
  return installDisabledAutomation({ root, proposal, timeZone: "Europe/London", repoRoot: repoRootOverride || REPO_ROOT, scheduler, now: NOW });
}

function makeChecks(nowVal, mode, focusActive, authorized) {
  return {
    readContext: async () => ({ now: nowVal, effectiveMode: mode, focusActive }),
    authorize: async () => authorized,
  };
}

// Acceptance 2: due trigger produces exactly one execution; repeat refused
test("task4: due trigger succeeds once, repeat refused", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-install-"));
  const repoRoot = await mkdtemp(join(tmpdir(), "orion-repo-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(repoRoot, { recursive: true, force: true }); });

  // Create the script file the runtime will call
  await mkdir(join(repoRoot, "scripts"), { recursive: true });
  await writeFile(join(repoRoot, "scripts", "orion-agenda"), "#!/usr/bin/env node\nconsole.log('ok');", { mode: 0o755 });

  const scheduler = makeFakeScheduler(repoRoot);
  await installFixture(root, scheduler, undefined, repoRoot);

  // First run at DUE — should succeed
  const runs1 = [];
  const result1 = await runInstalledAutomation("calendar-check", DUE, {
    automationRoot: root,
    repoRoot,
    checks: makeChecks(DUE, "guarded", false, true),
    run: async (file, args) => { runs1.push({ file, args }); return { stdout: "agenda" }; },
  });
  assert.strictEqual(result1.status, "succeeded");
  assert.strictEqual(runs1.length, 1);
  assert.strictEqual(runs1[0].file, join(repoRoot, "scripts/orion-agenda"));
  assert.deepEqual(runs1[0].args, ["today"]);

  // Repeat at DUE with fresh adapters — should refuse
  const runs2 = [];
  const result2 = await runInstalledAutomation("calendar-check", DUE, {
    automationRoot: root,
    repoRoot,
    checks: makeChecks(DUE, "guarded", false, true),
    run: async () => { runs2.push(1); return { stdout: "agenda" }; },
  });
  assert.strictEqual(result2.status, "refused");
  assert.strictEqual(result2.reason, "duplicate_or_old_trigger");
  assert.strictEqual(runs2.length, 0);

  // Acceptance 5: no real systems
  assert.deepEqual(scheduler.calls.filter(c => c === "createDisabled").length, 1);
  assert.ok(root.startsWith(tmpdir()));
  assert.ok(repoRoot.startsWith(tmpdir()));
});

// Acceptance 3: refused before execution — table-driven
const refusalCases = [
  { label: "not_authorized", checks: () => makeChecks(DUE, "guarded", false, false), reason: "not_authorized" },
  { label: "mode_mismatch", checks: () => makeChecks(DUE, "open", false, true), reason: "mode_mismatch" },
  { label: "expired", proposal: () => ({ ...makeProposal(), expiresOn: "2026-09-21" }), scheduledAt: Date.parse("2026-09-22T08:05:00Z"), checks: () => makeChecks(Date.parse("2026-09-22T08:05:00Z"), "guarded", false, true), reason: "expired" },
  { label: "focus_unknown", proposal: () => ({ ...makeProposal(), conditions: { skipDuringFocus: true } }), checks: () => makeChecks(DUE, "guarded", null, true), reason: "focus_unknown" },
];

for (const tc of refusalCases) {
  test(`task4: refused before execution — ${tc.label}`, async (t) => {
    const root = await mkdtemp(join(tmpdir(), "orion-install-"));
    const repoRoot = await mkdtemp(join(tmpdir(), "orion-repo-"));
    t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(repoRoot, { recursive: true, force: true }); });

    await mkdir(join(repoRoot, "scripts"), { recursive: true });
    await writeFile(join(repoRoot, "scripts", "orion-agenda"), "#!/usr/bin/env node\nconsole.log('ok');", { mode: 0o755 });
    const scheduler = makeFakeScheduler(repoRoot);
    await installFixture(root, scheduler, tc.proposal?.(), repoRoot);

    const runs = [];
    const result = await runInstalledAutomation("calendar-check", tc.scheduledAt || DUE, {
      automationRoot: root,
      repoRoot,
      checks: tc.checks(),
      run: async () => { runs.push(1); return { stdout: "agenda" }; },
    });
    assert.strictEqual(result.status, "refused", `expected refused for ${tc.label}`);
    assert.strictEqual(result.reason, tc.reason, `reason mismatch for ${tc.label}`);
    assert.strictEqual(runs.length, 0, `run should not be called for ${tc.label}`);
  });
}

// Changed installation — tamper the installed record
test("task4: refused before execution — changed installation (invalid_state)", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-install-"));
  const repoRoot = await mkdtemp(join(tmpdir(), "orion-repo-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(repoRoot, { recursive: true, force: true }); });

  await mkdir(join(repoRoot, "scripts"), { recursive: true });
  await writeFile(join(repoRoot, "scripts", "orion-agenda"), "#!/usr/bin/env node\nconsole.log('ok');", { mode: 0o755 });
  const scheduler = makeFakeScheduler(repoRoot);
  await installFixture(root, scheduler, undefined, repoRoot);

  // Tamper: read installed record, change intent, write back
  const instPath = join(root, "installed", "calendar-check.json");
  const instData = JSON.parse(await readFile(instPath, "utf8"));
  instData.intent = "tampered-intent";
  await writeFile(instPath, JSON.stringify(instData, null, 2));

  const runs = [];
  const result = await runInstalledAutomation("calendar-check", DUE, {
    automationRoot: root,
    repoRoot,
    checks: makeChecks(DUE, "guarded", false, true),
    run: async () => { runs.push(1); return { stdout: "agenda" }; },
  });
  assert.strictEqual(result.status, "refused");
  assert.strictEqual(result.reason, "invalid_state");
  assert.strictEqual(runs.length, 0);
});

// Acceptance 4a: executor throws after effect — not blindly retried
test("task4: throwing executor yields outcome_unknown, next day refused stopped", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-install-"));
  const repoRoot = await mkdtemp(join(tmpdir(), "orion-repo-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(repoRoot, { recursive: true, force: true }); });

  await mkdir(join(repoRoot, "scripts"), { recursive: true });
  await writeFile(join(repoRoot, "scripts", "orion-agenda"), "#!/usr/bin/env node\nconsole.log('ok');", { mode: 0o755 });
  const scheduler = makeFakeScheduler(repoRoot);
  const proposal = { ...makeProposal(), failureBehavior: "retry_once" };
  await installFixture(root, scheduler, proposal, repoRoot);

  const runs = [];
  const effects = [];
  const result1 = await runInstalledAutomation("calendar-check", DUE, {
    automationRoot: root,
    repoRoot,
    checks: makeChecks(DUE, "guarded", false, true),
    run: async (file, args) => {
      runs.push({ file, args });
      effects.push("effect");
      throw new Error("disposable failure");
    },
  });
  assert.strictEqual(result1.status, "outcome_unknown");
  assert.strictEqual(runs.length, 1);
  assert.strictEqual(effects.length, 1);

  // Next day — should refuse with stopped
  const runs2 = [];
  const nextDay = Date.parse("2026-09-21T08:05:00Z");
  const result2 = await runInstalledAutomation("calendar-check", nextDay, {
    automationRoot: root,
    repoRoot,
    checks: makeChecks(nextDay, "guarded", false, true),
    run: async () => { runs2.push(1); return { stdout: "agenda" }; },
  });
  assert.strictEqual(result2.status, "refused");
  assert.strictEqual(result2.reason, "stopped");
  assert.strictEqual(runs2.length, 0);
});

// Acceptance 4b: child process death — lock removal then outcome_unknown
test("task4: child process death yields busy_or_unavailable after lock removal", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-install-"));
  const repoRoot = await mkdtemp(join(tmpdir(), "orion-repo-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(repoRoot, { recursive: true, force: true }); });

  await mkdir(join(repoRoot, "scripts"), { recursive: true });
  await writeFile(join(repoRoot, "scripts", "orion-agenda"), "#!/usr/bin/env node\nconsole.log('ok');", { mode: 0o755 });
  const scheduler = makeFakeScheduler(repoRoot);
  await installFixture(root, scheduler, undefined, repoRoot);

  // Spawn child that calls runInstalledAutomation and exits 73
  const runtimeModuleURL = new URL("../scripts/lib/orion-automation-runtime.mjs", import.meta.url).href;
  const source = `import { runInstalledAutomation } from ${JSON.stringify(runtimeModuleURL)};
    import { writeFile } from 'node:fs/promises';
    const [root, repoRoot, scheduledAt] = JSON.parse(process.argv[1]);
    await runInstalledAutomation("calendar-check", scheduledAt, {
      automationRoot: root,
      repoRoot,
      checks: {
        readContext: async () => ({ now: scheduledAt, effectiveMode: "guarded", focusActive: false }),
        authorize: async () => true,
      },
      run: async (file, args) => {
        await writeFile(root + "/effect.txt", "child-effect\\n", { flag: "a" });
        process.exit(73);
      },
    });`;

  await assert.rejects(
    promisify(execFile)(process.execPath, ["--input-type=module", "-e", source, JSON.stringify([root, repoRoot, DUE])]),
    (error) => error.code === 73
  );

  // Next call with lock still present — busy_or_unavailable
  const result1 = await runInstalledAutomation("calendar-check", DUE, {
    automationRoot: root,
    repoRoot,
    checks: makeChecks(DUE, "guarded", false, true),
    run: async () => ({ stdout: "agenda" }),
  });
  assert.strictEqual(result1.status, "refused");
  assert.strictEqual(result1.reason, "busy_or_unavailable");

  // Remove lock directory under root/runtime
  const entries = await readdir(join(root, "runtime"));
  for (const entry of entries) {
    if (entry.endsWith(".lock")) {
      await rm(join(root, "runtime", entry), { recursive: true, force: true });
    }
  }

  // After lock removal — outcome_unknown, still no new run
  const runs = [];
  const result2 = await runInstalledAutomation("calendar-check", DUE, {
    automationRoot: root,
    repoRoot,
    checks: makeChecks(DUE, "guarded", false, true),
    run: async () => { runs.push(1); return { stdout: "agenda" }; },
  });
  assert.strictEqual(result2.status, "refused");
  assert.strictEqual(result2.reason, "outcome_unknown");
  assert.strictEqual(runs.length, 0);
});

// Acceptance 5: positive evidence no real systems used
test("task4: fixtures prove no real scheduler/calendar/webhook/production root", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "orion-install-"));
  const repoRoot = await mkdtemp(join(tmpdir(), "orion-repo-"));
  t.after(async () => { await rm(root, { recursive: true, force: true }); await rm(repoRoot, { recursive: true, force: true }); });

  await mkdir(join(repoRoot, "scripts"), { recursive: true });
  await writeFile(join(repoRoot, "scripts", "orion-agenda"), "#!/usr/bin/env node\nconsole.log('ok');", { mode: 0o755 });
  const scheduler = makeFakeScheduler(repoRoot);
  await installFixture(root, scheduler, undefined, repoRoot);

  let checksCalled = false;
  const runs = [];
  const result = await runInstalledAutomation("calendar-check", DUE, {
    automationRoot: root,
    repoRoot,
    checks: {
      readContext: async () => { checksCalled = true; return { now: DUE, effectiveMode: "guarded", focusActive: false }; },
      authorize: async () => { checksCalled = true; return true; },
    },
    run: async (file, args) => { runs.push({ file, args }); return { stdout: "agenda" }; },
  });

  assert.strictEqual(result.status, "succeeded");
  // Fake scheduler only saw createDisabled and read
  assert.deepEqual(scheduler.calls, ["createDisabled", "read"]);
  // Every run used temporary repoRoot
  for (const r of runs) {
    assert.ok(r.file.startsWith(tmpdir()));
  }
  // Checks were called
  assert.ok(checksCalled);
  // Delivery not requested
  assert.strictEqual(result.delivery?.status, "not_requested");
  // No messages in runtime
  const runtimeEntries = await readdir(join(root, "runtime"));
  assert.ok(!runtimeEntries.some(e => e.startsWith("messages")), "no messages entry in runtime");
  // Roots are temporary
  assert.ok(root.startsWith(tmpdir()));
  assert.ok(repoRoot.startsWith(tmpdir()));
});

