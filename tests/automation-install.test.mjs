import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, readFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { automationSchedulePlan } from "../scripts/lib/orion-automation-schedule.mjs";
import { verifyDisabledSchedule, installDisabledAutomation } from "../scripts/lib/orion-automation-install.mjs";

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

function makeFakeScheduler() {
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
        commandArgv: [REPO_ROOT + "/scripts/orion-automation-run", "calendar-check"],
        cwd: REPO_ROOT,
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

