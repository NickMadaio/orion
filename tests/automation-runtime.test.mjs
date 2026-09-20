import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runInstalledAutomation } from "../scripts/lib/orion-automation-runtime.mjs";
import { initializeAutomationDispatch } from "../scripts/lib/orion-automation-dispatch.mjs";

const at = Date.parse("2026-09-20T10:00:00Z");
async function fixture(t, change = {}) {
  const root = await mkdtemp(join(tmpdir(), "orion-runtime-"));
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
test("installed runtime uses fixed argv, explicit timezone and bounded process options; replay refuses", async t => {
  const f = await fixture(t); const result = await f.dispatch();
  assert.equal(result.status, "succeeded"); assert.equal(result.output, "fixture calendar");
  assert.equal(f.state.authorityCalls, 2); assert.equal(f.state.contextCalls, 2);
  const call = f.state.launches[0];
  assert.equal(call.file, join(f.root, "scripts/orion-agenda")); assert.deepEqual(call.args, ["today"]);
  assert.equal(call.opts.env.TZ, "UTC"); assert.equal(call.opts.timeout, 35000);
  assert.equal(call.opts.killSignal, "SIGKILL"); assert.equal(call.opts.maxBuffer, 1048576);
  assert.equal((await f.dispatch()).reason, "duplicate_or_old_trigger"); assert.equal(f.state.launches.length, 1);
});
test("missing, malformed, mismatched and unsupported installation never launches", async t => {
  const f = await fixture(t);
  for (const contents of ["{broken", JSON.stringify({ ...f.record, name: "other" }),
    JSON.stringify({ ...f.record, action: "daily_rollup" }), JSON.stringify({ ...f.record, installedAt: null }),
    JSON.stringify({ ...f.record, delivery: { targetId: "someone" } })]) {
    await writeFile(f.file, contents); assert.equal((await f.dispatch()).status, "refused");
  }
  await rm(f.file); assert.equal((await f.dispatch()).status, "refused");
  assert.equal((await runInstalledAutomation("../other", at, f.options)).reason, "invalid_name");
  assert.equal(f.state.launches.length, 0);
});
test("missing runtime ledger is never initialized from an installed record", async t => {
  const f = await fixture(t); await rm(join(f.root, "runtime"), { recursive: true });
  assert.equal((await f.dispatch()).status, "refused"); assert.equal(f.state.launches.length, 0);
});
test("revocation between dispatch admission and execution prevents launch", async t => {
  const f = await fixture(t); f.state.authorize = count => count === 1;
  assert.equal((await f.dispatch()).status, "failed"); assert.equal(f.state.launches.length, 0);
});
test("authority revoked during final focus probe cannot reach subprocess", async t => {
  const f = await fixture(t); let allowed = true;
  f.state.authorize = () => allowed;
  f.state.beforeContext = count => { if (count === 2) allowed = false; };
  assert.equal((await f.dispatch()).status, "failed"); assert.equal(f.state.launches.length, 0);
});
test("record removal or change during final checks prevents launch", async t => {
  for (const remove of [true, false]) {
    const f = await fixture(t);
    f.state.beforeContext = async count => { if (count === 2) {
      if (remove) await rm(f.file); else await writeFile(f.file, JSON.stringify({ ...f.record, intent: "changed" }));
    } };
    assert.equal((await f.dispatch()).status, "failed"); assert.equal(f.state.launches.length, 0);
  }
});
test("focus, mode, expiry, backward clock and stale trigger are rechecked before launch", async t => {
  for (const change of [{ focusActive: true }, { focusActive: null }, { effectiveMode: "open" },
    { now: at - 1 }, { now: at + 300001 }, { now: Date.parse("2026-09-21T00:00:00Z") }]) {
    const f = await fixture(t);
    f.state.beforeContext = count => { if (count === 2) Object.assign(f.state.context, change); };
    assert.equal((await f.dispatch()).status, "failed"); assert.equal(f.state.launches.length, 0);
  }
});
test("launched process failures never retry even with retry_once", async t => {
  for (const code of ["ETIMEDOUT", "ERR_CHILD_PROCESS_STDIO_MAXBUFFER", 1]) {
    const f = await fixture(t, { failureBehavior: "retry_once" });
    f.state.failure = Object.assign(new Error("private stderr must not escape"), { code });
    const result = await f.dispatch();
    assert.equal(result.status, "outcome_unknown"); assert.equal(f.state.launches.length, 1);
    assert.equal(JSON.stringify(result).includes("private"), false);
    assert.equal((await f.dispatch()).reason, "stopped");
  }
});
test("real fixture subprocess runs once through installed record and dispatcher", async t => {
  const f = await fixture(t); await mkdir(join(f.root, "scripts"));
  await writeFile(join(f.root, "scripts/orion-agenda"), "#!/bin/sh\nprintf 'fixture subprocess\\n'\n", { mode: 0o700 });
  delete f.options.run;
  assert.equal((await f.dispatch()).output, "fixture subprocess\n");
  assert.equal((await f.dispatch()).reason, "duplicate_or_old_trigger");
  assert.equal(JSON.parse(await readFile(f.file, "utf8")).installationId, f.record.installationId);
});
test("actual subprocess side effect followed by failure is never executed again", async t => {
  const f = await fixture(t, { failureBehavior: "retry_once" }); await mkdir(join(f.root, "scripts"));
  const effect = join(f.root, "effect.txt");
  await writeFile(join(f.root, "scripts/orion-agenda"),
    `#!/bin/sh\nprintf 'one effect\\n' >> '${effect}'\nexit 1\n`, { mode: 0o700 });
  delete f.options.run;
  assert.equal((await f.dispatch()).status, "outcome_unknown");
  assert.equal((await f.dispatch()).reason, "stopped");
  assert.equal(await readFile(effect, "utf8"), "one effect\n");
});
test("execution crossing civil midnight or quiet-hour boundary is withheld", async t => {
  for (const midnight of [true, false]) {
    const scheduled = Date.parse(midnight ? "2026-09-20T23:59:00Z" : "2026-09-20T10:59:00Z");
    const f = await fixture(t, { expiresOn: "2026-09-21", trigger: { kind: "hourly", atMinute: 59 },
      conditions: midnight ? {} : { quietHours: [11, 12] } });
    f.state.context.now = scheduled;
    f.state.beforeContext = count => { if (count === 2) f.state.context.now = scheduled + 60000; };
    assert.equal((await runInstalledAutomation(f.record.name, scheduled, f.options)).status, "failed");
    assert.equal(f.state.launches.length, 0);
  }
});
