import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { automationSchedulePlan } from "../scripts/lib/orion-automation-schedule.mjs";
import { automationTick } from "../scripts/lib/orion-automation-tick.mjs";

const proposal = () => ({ name: "calendar-check", intent: "Read the calendar at the chosen time", action: "agenda_today",
  expiresOn: new Date(Date.now() + 7 * 86400000).toISOString().slice(0, 10),
  trigger: { kind: "daily", atHour: 9, atMinute: 5 }, conditions: {}, permissions: { expectsMode: "guarded" },
  riskLimits: { maxRunsPerDay: 2, maxMessagesPerDay: 0 }, failureBehavior: "stop" });
test("plan derives supported cron flags and argv without scheduling or delivery", () => {
  const p = proposal(); p.command = "malicious arbitrary shell";
  const plan = automationSchedulePlan(p, "Europe/London", "/fixture/repo with spaces");
  assert.equal(plan.cron, "5 9 * * *"); assert.equal(plan.readyToInstall, false);
  assert.deepEqual(plan.commandArgv, ["/fixture/repo with spaces/scripts/orion-automation-run", p.name]);
  assert.deepEqual(JSON.parse(plan.schedulerArgs[plan.schedulerArgs.indexOf("--command-argv") + 1]), plan.commandArgv);
  for (const flag of ["--disabled", "--exact", "--no-deliver", "--json", "--tz", "--cron"]) assert.ok(plan.schedulerArgs.includes(flag));
  for (const flag of ["--schedule", "--timezone", "--command", "--message", "--announce"]) assert.ok(!plan.schedulerArgs.includes(flag));
  assert.ok(!JSON.stringify(plan).includes(p.command));
});
test("hourly and weekly shapes derive exact cron expressions", () => {
  for (const [trigger, cron] of [[{ kind: "hourly", atMinute: 17 }, "17 * * * *"],
    [{ kind: "weekly", weekday: 2, atHour: 11, atMinute: 30 }, "30 11 * * 2"]]) {
    assert.equal(automationSchedulePlan({ ...proposal(), trigger }, "UTC", "/repo").cron, cron);
  }
});
test("expiry follows chosen timezone including opposite dates and maximum calendar lifetime", () => {
  const p = { ...proposal(), expiresOn: "2026-09-20" };
  const now = Date.parse("2026-09-21T00:30:00Z");
  assert.doesNotThrow(() => automationSchedulePlan(p, "America/Los_Angeles", "/repo", now));
  assert.throws(() => automationSchedulePlan(p, "Asia/Tokyo", "/repo", now), /Expiry/);
  p.expiresOn = "2026-09-21";
  assert.doesNotThrow(() => automationSchedulePlan(p, "Asia/Tokyo", "/repo", now));
  const boundary = new Date(Date.parse("2026-09-21T00:00:00Z") + 180 * 86400000).toISOString().slice(0, 10);
  p.expiresOn = boundary;
  assert.doesNotThrow(() => automationSchedulePlan(p, "Asia/Tokyo", "/repo", now));
  assert.throws(() => automationSchedulePlan(p, "America/Los_Angeles", "/repo", now), /Expiry/);
  assert.throws(() => automationSchedulePlan(p, "UTC", "/repo", Date.parse("+010000-01-01T00:00:00Z")), /Expiry/);
});
test("unsupported scope, invalid dates, missing timezone and unsafe names refuse", () => {
  for (const change of [{ action: "daily_rollup" }, { delivery: { targetId: "someone" } },
    { name: "../outside" }, { expiresOn: "2026-02-30" }, { conditions: { skipDuringFocus: "false" } },
    { trigger: { kind: "raw", cron: "* * * * *" } }]) {
    assert.throws(() => automationSchedulePlan({ ...proposal(), ...change }, "UTC", "/repo"));
  }
  for (const zone of [undefined, "", "EST", "invented/timezone"]) assert.throws(() => automationSchedulePlan(proposal(), zone, "/repo"));
});
test("tick accepts only installed name and current minute; strips private output", async () => {
  const calls = [];
  const result = await automationTick(["calendar-check"], { now: () => 125999,
    run: async (...args) => { calls.push(args); return { status: "succeeded", output: "private calendar", stderr: "private error" }; } });
  assert.deepEqual(calls, [["calendar-check", 120000]]);
  assert.deepEqual(result, { exitCode: 0, summary: { status: "succeeded" } });
});
test("tick rejects override arguments without invoking runtime", async () => {
  for (const args of [[], ["../bad"], ["calendar-check", "--timezone", "UTC"], ["calendar-check", "123456"]]) {
    const result = await automationTick(args, { run: () => { throw new Error("must not run"); } });
    assert.equal(result.exitCode, 2);
  }
});
test("tick reports safe failure summaries and never leaks thrown details", async () => {
  for (const status of ["refused", "failed", "outcome_unknown"]) {
    assert.deepEqual(await automationTick(["calendar-check"], { run: async () => ({ status, reason: "expired", output: "private" }) }),
      { exitCode: 1, summary: { status, reason: "expired" } });
  }
  for (const run of [async () => { throw new Error("secret"); }, async () => ({ status: "secret" })]) {
    assert.deepEqual(await automationTick(["calendar-check"], { run }),
      { exitCode: 1, summary: { status: "refused", reason: "runtime_unavailable" } });
  }
});
test("actual entrypoint rejects invalid argv before any policy lookup", async () => {
  const result = await promisify(execFile)(process.execPath,
    [new URL("../scripts/orion-automation-run", import.meta.url).pathname, "../invalid"]).catch(error => error);
  assert.equal(result.code, 2);
  assert.deepEqual(JSON.parse(result.stdout), { status: "refused", reason: "invalid_arguments" });
});
