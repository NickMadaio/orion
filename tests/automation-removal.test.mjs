import test from "node:test";
import assert from "node:assert/strict";
import { removeAutomationSchedule } from "../scripts/lib/orion-automation-removal.mjs";

const job = { id: "job-1", name: "orion-auto-brief" };
const page = jobs => ({ stdout: JSON.stringify({ jobs, total: jobs.length, offset: 0, hasMore: false }) });
function runner(responses) {
  const calls = [];
  return { calls, run: async (...args) => {
    calls.push(args);
    assert.ok(responses.length, "unexpected scheduler call");
    const response = responses.shift();
    if (response instanceof Error) throw response;
    return response;
  } };
}
test("exact match removed, verified absent, similarly named job preserved", async () => {
  const other = { id: "job-2", name: "orion-auto-brief-weekly" };
  const fake = runner([page([other, job]), { stdout: '{}' }, page([other])]);
  assert.deepEqual(await removeAutomationSchedule(fake.run, "scheduler", "brief"),
    { removed: true, alreadyAbsent: false, id: "job-1" });
  assert.deepEqual(fake.calls.map(c => c[1]), [
    ["cron", "list", "--all", "--json"],
    ["cron", "remove", "job-1", "--json"],
    ["cron", "list", "--all", "--json"],
  ]);
});
test("verified absence makes no removal call", async () => {
  const fake = runner([page([])]);
  assert.equal((await removeAutomationSchedule(fake.run, "scheduler", "brief")).alreadyAbsent, true);
  assert.equal(fake.calls.length, 1);
});
test("list outage cannot be reported as absent", async () => {
  const fake = runner([new Error("unavailable")]);
  await assert.rejects(removeAutomationSchedule(fake.run, "scheduler", "brief"));
  assert.equal(fake.calls.length, 1);
});
test("removal failure does not authorize local state transition", async () => {
  const fake = runner([page([job]), new Error("denied")]);
  let transitioned = false;
  await assert.rejects(async () => {
    await removeAutomationSchedule(fake.run, "scheduler", "brief");
    transitioned = true;
  });
  assert.equal(transitioned, false);
});
test("success response alone is insufficient when schedule remains or is recreated", async () => {
  for (const remaining of [job, { ...job, id: "replacement" }]) {
    const fake = runner([page([job]), { stdout: '{}' }, page([remaining])]);
    await assert.rejects(removeAutomationSchedule(fake.run, "scheduler", "brief"), /still present/);
  }
});
test("post-removal outage retains local installation for retry", async () => {
  const fake = runner([page([job]), { stdout: '{}' }, new Error("offline")]);
  await assert.rejects(removeAutomationSchedule(fake.run, "scheduler", "brief"));
});
test("malformed, incomplete, ambiguous and duplicate-ID readings refuse", async () => {
  for (const response of [
    { stdout: "not JSON" }, { stdout: '{}' },
    { stdout: JSON.stringify({ jobs: [], total: 1, offset: 0, hasMore: false }) },
    { stdout: JSON.stringify({ jobs: [], total: 0, offset: 2, hasMore: false }) },
    { stdout: JSON.stringify({ jobs: [], total: 0, offset: 0, hasMore: true }) },
    page([{}]), page([job, job]), page([job, { ...job, id: "job-2" }]),
  ]) {
    const fake = runner([response]);
    await assert.rejects(removeAutomationSchedule(fake.run, "scheduler", "brief"));
    assert.equal(fake.calls.length, 1);
  }
});
test("unsafe names cannot reach scheduler", async () => {
  for (const name of ["../brief", "brief/../../outside", "brief;command", ""]) {
    const fake = runner([]);
    await assert.rejects(removeAutomationSchedule(fake.run, "scheduler", name), /invalid/);
    assert.equal(fake.calls.length, 0);
  }
});
