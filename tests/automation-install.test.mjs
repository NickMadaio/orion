import test from "node:test";
import assert from "node:assert/strict";
import { automationSchedulePlan } from "../scripts/lib/orion-automation-schedule.mjs";
import { verifyDisabledSchedule } from "../scripts/lib/orion-automation-install.mjs";

const proposal = () => ({ name: "calendar-check", intent: "Read the calendar at the chosen time", action: "agenda_today",
  expiresOn: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
  trigger: { kind: "daily", atHour: 9, atMinute: 5 }, conditions: {}, permissions: { expectsMode: "guarded" },
  riskLimits: { maxRunsPerDay: 2, maxMessagesPerDay: 0 }, failureBehavior: "stop" });

function makeExpected() {
  return automationSchedulePlan(proposal(), "Europe/London", "/fixture/repo with spaces");
}

// Handwritten valid observed fixture per brief — not derived from the plan.
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
  // Handwritten literal fixture — not derived from the plan object.
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
  // Passing the plan itself as observed must fail because it lacks id, enabled, exact, noDeliver fields
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
