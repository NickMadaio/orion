import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInstalledAutomation } from "../scripts/lib/orion-automation-runtime.mjs";
import { initializeAutomationDispatch } from "../scripts/lib/orion-automation-dispatch.mjs";
import { readAutomationHistory } from "../scripts/lib/orion-automation-history.mjs";

const at = Date.parse("2026-09-20T10:00:00Z");

async function fixture(t, change = {}) {
  const root = await mkdtemp(join(tmpdir(), "orion-hist-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const record = { name: "runtime-test", installationId: "runtime-test-0001", action: "agenda_today",
    installedAt: "2026-09-20T09:00:00Z", timeZone: "UTC", expiresOn: "2026-09-20",
    permissions: { expectsMode: "guarded" }, conditions: { skipDuringFocus: true },
    riskLimits: { maxRunsPerDay: 10 }, failureBehavior: "stop", trigger: { kind: "hourly", atMinute: 0 }, ...change };
  await mkdir(join(root, "installed"));
  const file = join(root, "installed/runtime-test.json");
  await writeFile(file, JSON.stringify(record));
  await initializeAutomationDispatch(join(root, "runtime"), record);
  const state = { contextCalls: 0, authorityCalls: 0, launches: [],
    context: { now: at, effectiveMode: "guarded", focusActive: false } };
  const options = { automationRoot: root, repoRoot: root,
    checks: {
      readContext: async () => {
        state.contextCalls++; if (state.beforeContext) await state.beforeContext(state.contextCalls);
        return { ...state.context };
      },
      authorize: async () => {
        state.authorityCalls++; return state.authorize ? state.authorize(state.authorityCalls) : true;
      },
    },
    run: async (file, args, opts) => {
      state.launches.push({ file, args, opts });
      if (state.failure) throw state.failure;
      return { stdout: "fixture calendar" };
    },
  };
  return { root, file, record, state, options, dispatch: () => runInstalledAutomation(record.name, at, options) };
}

test("a succeeded dispatch is recorded once with its delivery status", async t => {
  const f = await fixture(t);
  const result = await f.dispatch();
  assert.equal(result.status, "succeeded");
  const history = await readAutomationHistory(join(f.root, "history", "runtime-test.jsonl"));
  assert.equal(history.entries.length, 1);
  const entry = history.entries[0];
  assert.equal(entry.at, at);
  assert.equal(entry.name, "runtime-test");
  assert.equal(entry.status, "succeeded");
  assert.equal(entry.reason, null);
  assert.equal(entry.delivery, "not_requested");
});

test("a replay is recorded as refused with its reason", async t => {
  const f = await fixture(t);
  await f.dispatch();
  await f.dispatch();
  const history = await readAutomationHistory(join(f.root, "history", "runtime-test.jsonl"));
  assert.equal(history.entries.length, 2);
  const second = history.entries[1];
  assert.equal(second.status, "refused");
  assert.equal(second.reason, "duplicate_or_old_trigger");
  assert.equal(second.delivery, null);
});

test("a trigger that is not due records nothing", async t => {
  const f = await fixture(t);
  const result = await runInstalledAutomation("runtime-test", at + 60000, f.options);
  assert.equal(result.reason, "not_due");
  const history = await readAutomationHistory(join(f.root, "history", "runtime-test.jsonl"));
  assert.equal(history.entries.length, 0);
});

test("an unwritable history location does not change the result", async t => {
  const f = await fixture(t);
  // Make history path a regular file so mkdir fails inside appendAutomationHistory
  await writeFile(join(f.root, "history"), "not a directory");
  const result = await f.dispatch();
  assert.equal(result.status, "succeeded");
  assert.equal(result.output, "fixture calendar");
});

test("early refusals are not recorded", async t => {
  const f = await fixture(t);
  // Test invalid_name early refusal
  const badResult = await runInstalledAutomation("../other", at, f.options);
  assert.equal(badResult.reason, "invalid_name");
  
  // Test installation_unavailable_or_unsupported early refusal
  await rm(f.file);
  const missingResult = await f.dispatch();
  assert.equal(missingResult.status, "refused");
  
  // History directory should not exist in either case
  try {
    await readFile(join(f.root, "history"));
    assert.fail("history directory should not exist");
  } catch (err) {
    assert.equal(err.code, "ENOENT");
  }
});

