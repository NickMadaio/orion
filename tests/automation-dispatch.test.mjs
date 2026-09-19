import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, readdir, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { initializeAutomationDispatch as initialize, dispatchAutomation as dispatch } from "../scripts/lib/orion-automation-dispatch.mjs";

const start = Date.parse("2026-09-19T12:00:00Z");
const policy = () => ({ name: "test-agenda", installationId: "dispatch-test-0001", timeZone: "Europe/London",
  expiresOn: "2026-12-31", trigger: { kind: "hourly", atMinute: 0 }, conditions: {}, action: "agenda_today",
  permissions: { expectsMode: "guarded" }, riskLimits: { maxRunsPerDay: 10 }, failureBehavior: "stop" });
async function setup(t, record = policy()) {
  const root = await mkdtemp(join(tmpdir(), "orion-dispatch-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await initialize(root, record);
  const calls = [], host = { now: start, authorized: true, result: { ok: true, output: "fixture" } };
  const adapters = {
    readContext: async () => ({ now: host.now, effectiveMode: "guarded", focusActive: false }),
    authorize: async action => { calls.push(["authorize", action]); return host.authorized; },
    execute: async action => { calls.push(["execute", action]); return host.result; },
  };
  return { root, record, calls, host, adapters };
}
const executions = f => f.calls.filter(([kind]) => kind === "execute").length;
test("admitted fixed action executes once and durable receipt refuses replay after reload", async t => {
  const f = await setup(t);
  f.adapters.execute = async action => {
    f.calls.push(["execute", action]);
    const receiptFile = (await readdir(f.root)).find(name => name.endsWith('.dispatch.json'));
    assert.equal(JSON.parse(await readFile(join(f.root, receiptFile), "utf8")).phase, "pending");
    await writeFile(join(f.root, "effect.txt"), "local disposable effect");
    return { ok: true, output: "local result" };
  };
  assert.equal((await dispatch(f.root, f.record, start, f.adapters)).status, "succeeded");
  assert.equal(await readFile(join(f.root, "effect.txt"), "utf8"), "local disposable effect");
  assert.deepEqual(f.calls[1][1].argv, ["orion-agenda", "today"]);
  assert.equal((await dispatch(f.root, structuredClone(f.record), start, f.adapters)).reason, "duplicate_or_old_trigger");
  assert.equal(executions(f), 1);
});
test("authority and expiry refusal execute nothing", async t => {
  const f = await setup(t); f.host.authorized = false;
  assert.equal((await dispatch(f.root, f.record, start, f.adapters)).reason, "not_authorized");
  assert.equal(executions(f), 0);
  const p = policy(); p.expiresOn = "2026-09-18"; const expired = await setup(t, p);
  assert.equal((await dispatch(expired.root, p, start, expired.adapters)).reason, "expired");
  assert.equal(executions(expired), 0);
});
test("off-schedule, stale and future triggers refuse", async t => {
  const f = await setup(t);
  assert.equal((await dispatch(f.root, f.record, start + 60000, f.adapters)).reason, "not_due");
  f.host.now = start + 300001;
  assert.equal((await dispatch(f.root, f.record, start, f.adapters)).reason, "stale_or_future_trigger");
  f.host.now = start - 1;
  assert.equal((await dispatch(f.root, f.record, start, f.adapters)).reason, "stale_or_future_trigger");
  assert.equal(executions(f), 0);
});
test("concurrent dispatches cannot overlap action execution", async t => {
  const f = await setup(t);
  const results = await Promise.all(Array.from({ length: 8 }, () => dispatch(f.root, f.record, start, f.adapters)));
  assert.equal(results.filter(r => r.status === "succeeded").length, 1);
  assert.equal(executions(f), 1);
});
test("retry_once retries certified side-effect-free failure and reauthorizes", async t => {
  const p = policy(); p.failureBehavior = "retry_once"; const f = await setup(t, p);
  f.adapters.execute = async action => {
    f.calls.push(["execute", action]);
    return executions(f) === 1 ? { ok: false, retrySafe: true } : { ok: true };
  };
  const result = await dispatch(f.root, p, start, f.adapters);
  assert.equal(result.status, "succeeded"); assert.equal(result.attempts, 2);
  assert.equal(f.calls.filter(([kind]) => kind === "authorize").length, 2);
  const states = await readdir(join(f.root, "admission"));
  assert.equal(JSON.parse(await readFile(join(f.root, "admission", states[0]), "utf8")).runs, 2);
});
test("a retry cannot exceed quota or bypass revoked authority", async t => {
  for (const quota of [true, false]) {
    const p = policy(); p.failureBehavior = "retry_once"; if (quota) p.riskLimits.maxRunsPerDay = 1;
    const f = await setup(t, p);
    f.adapters.execute = async action => {
      f.calls.push(["execute", action]); if (!quota) f.host.authorized = false;
      return { ok: false, retrySafe: true };
    };
    const result = await dispatch(f.root, p, start, f.adapters);
    assert.equal(result.reason, quota ? "daily_limit" : "not_authorized");
    assert.equal(result.status, "failed");
    assert.equal(result.attempts, 1);
    assert.equal(executions(f), 1);
    f.host.now += 3600000;
    assert.equal((await dispatch(f.root, p, f.host.now, f.adapters)).reason, "stopped");
  }
});
test("stop and exhausted retry_once persist stopped state", async t => {
  for (const behavior of ["stop", "retry_once"]) {
    const p = policy(); p.failureBehavior = behavior; const f = await setup(t, p);
    f.host.result = { ok: false, retrySafe: true };
    assert.equal((await dispatch(f.root, p, start, f.adapters)).status, "failed");
    assert.equal(executions(f), behavior === "stop" ? 1 : 2);
    f.host.now += 3600000;
    assert.equal((await dispatch(f.root, p, f.host.now, f.adapters)).reason, "stopped");
  }
});
test("report_and_continue allows next slot but never repeats failed slot", async t => {
  const p = policy(); p.failureBehavior = "report_and_continue"; const f = await setup(t, p);
  f.host.result = { ok: false, retrySafe: true };
  await dispatch(f.root, p, start, f.adapters);
  assert.equal((await dispatch(f.root, p, start, f.adapters)).reason, "duplicate_or_old_trigger");
  f.host.now += 3600000; f.host.result = { ok: true };
  assert.equal((await dispatch(f.root, p, f.host.now, f.adapters)).status, "succeeded");
});
test("throw or unknown outcome stops even retry and continue policies", async t => {
  for (const behavior of ["retry_once", "report_and_continue"]) {
    const p = policy(); p.failureBehavior = behavior; const f = await setup(t, p);
    f.adapters.execute = async action => { f.calls.push(["execute", action]); throw new Error("uncertain"); };
    assert.equal((await dispatch(f.root, p, start, f.adapters)).status, "outcome_unknown");
    assert.equal(executions(f), 1);
  }
});
test("pending receipt after uncertain termination blocks rerun", async t => {
  const f = await setup(t);
  const file = join(f.root, (await readdir(f.root)).find(n => n.endsWith('.dispatch.json')));
  const state = JSON.parse(await readFile(file, "utf8"));
  Object.assign(state, { phase: "pending", lastAt: start, lastSlot: "2026-09-19T13:00" });
  await writeFile(file, JSON.stringify(state));
  assert.equal((await dispatch(f.root, f.record, start, f.adapters)).reason, "outcome_unknown");
  assert.equal(executions(f), 0);
});
test("action mutation and unsupported actions cannot execute", async t => {
  const f = await setup(t);
  assert.equal((await dispatch(f.root, { ...f.record, action: "standing_check" }, start, f.adapters)).reason, "invalid_state");
  assert.equal((await dispatch(f.root, { ...f.record, action: "constructor" }, start, f.adapters)).reason, "invalid_installation");
  assert.equal(executions(f), 0);
});
test("fall-back repeated civil hour executes only once", async t => {
  const f = await setup(t); const first = Date.parse("2026-10-25T00:00Z"), second = Date.parse("2026-10-25T01:00Z");
  f.host.now = first; assert.equal((await dispatch(f.root, f.record, first, f.adapters)).status, "succeeded");
  f.host.now = second; assert.equal((await dispatch(f.root, f.record, second, f.adapters)).reason, "duplicate_or_old_trigger");
});
test("retry context or authority errors leave a non-ready receipt", async t => {
  for (const which of ["readContext", "authorize"]) {
    const p = policy(); p.failureBehavior = "retry_once"; const f = await setup(t, p);
    f.host.result = { ok: false, retrySafe: true };
    const original = f.adapters[which]; let calls = 0;
    f.adapters[which] = async (...args) => { if (++calls === 2) throw new Error('offline'); return original(...args); };
    assert.equal((await dispatch(f.root, p, start, f.adapters)).status, "outcome_unknown");
    f.host.now += 3600000;
    assert.equal((await dispatch(f.root, p, f.host.now, f.adapters)).reason, "outcome_unknown");
    assert.equal(executions(f), 1);
  }
});
test("daily and weekly triggers follow installed local civil time", async t => {
  for (const trigger of [{ kind: "daily", atHour: 13, atMinute: 0 },
    { kind: "weekly", weekday: 6, atHour: 13, atMinute: 0 }]) {
    const p = policy(); p.trigger = trigger; const f = await setup(t, p);
    assert.equal((await dispatch(f.root, p, start - 3600000, f.adapters)).reason, "not_due");
    assert.equal((await dispatch(f.root, p, start, f.adapters)).status, "succeeded");
  }
});
test("actual process death after an effect cannot replay after lock recovery", async t => {
  const f = await setup(t);
  const moduleURL = new URL('../scripts/lib/orion-automation-dispatch.mjs', import.meta.url).href;
  const source = `import {dispatchAutomation} from ${JSON.stringify(moduleURL)};
    import {writeFile} from 'node:fs/promises';
    const [root, record, at] = JSON.parse(process.argv[1]);
    await dispatchAutomation(root, record, at, {
      readContext: async () => ({now:at,effectiveMode:'guarded',focusActive:false}),
      authorize:async()=>true,
      execute:async()=>{await writeFile(root+'/effect.txt','happened');process.exit(73);}
    });`;
  await assert.rejects(promisify(execFile)(process.execPath, ['--input-type=module','-e',source,
    JSON.stringify([f.root, f.record, start])]), error => error.code === 73);
  assert.equal(await readFile(join(f.root, 'effect.txt'), 'utf8'), 'happened');
  assert.equal((await dispatch(f.root, f.record, start, f.adapters)).reason, 'busy_or_unavailable');
  // Only in the disposable fixture, after the child has positively exited.
  const lock = (await readdir(f.root)).find(name => name.endsWith('.lock'));
  await rm(join(f.root, lock), {recursive:true});
  assert.equal((await dispatch(f.root, f.record, start, f.adapters)).reason, 'outcome_unknown');
  assert.equal(executions(f), 0);
});
test("actual process death between attempts leaves retry blocked", async t => {
  const p = policy(); p.failureBehavior = 'retry_once'; const f = await setup(t, p);
  const moduleURL = new URL('../scripts/lib/orion-automation-dispatch.mjs', import.meta.url).href;
  const source = `import {dispatchAutomation} from ${JSON.stringify(moduleURL)};
    const [root, record, at] = JSON.parse(process.argv[1]);let reads=0;
    await dispatchAutomation(root, record, at, {
      readContext: async () => {if(++reads===2)process.exit(73);return {now:at,effectiveMode:'guarded',focusActive:false};},
      authorize:async()=>true, execute:async()=>({ok:false,retrySafe:true})
    });`;
  await assert.rejects(promisify(execFile)(process.execPath, ['--input-type=module','-e',source,
    JSON.stringify([f.root, p, start])]), error => error.code === 73);
  const lock = (await readdir(f.root)).find(name => name.endsWith('.lock'));
  await rm(join(f.root, lock), {recursive:true});
  f.host.now += 3600000;
  assert.equal((await dispatch(f.root, p, f.host.now, f.adapters)).reason, 'outcome_unknown');
  assert.equal(executions(f), 0);
});
test("receipt publication failures preserve execution truth and block unsafe replay", async t => {
  for (const failAt of [1, 2]) {
    const p = policy(); p.riskLimits.maxRunsPerDay = 1; const f = await setup(t, p);
    const moduleURL = new URL('../scripts/lib/orion-automation-dispatch.mjs', import.meta.url).href;
    const source = `import fs from 'node:fs/promises';import {syncBuiltinESMExports} from 'node:module';
      const [root, record, at, failAt] = JSON.parse(process.argv[1]);
      const rename=fs.rename;let writes=0;
      fs.rename=async(...args)=>{if(args[1].endsWith('.dispatch.json') && ++writes===failAt)throw new Error('injected');return rename(...args);};
      syncBuiltinESMExports();const {dispatchAutomation}=await import(${JSON.stringify(moduleURL)});
      console.log(JSON.stringify(await dispatchAutomation(root,record,at,{
        readContext:async()=>({now:at,effectiveMode:'guarded',focusActive:false}),authorize:async()=>true,
        execute:async()=>{await fs.writeFile(root+'/effect.txt','once');return {ok:true};}
      })));`;
    const result = JSON.parse((await promisify(execFile)(process.execPath, ['--input-type=module','-e',source,
      JSON.stringify([f.root,p,start,failAt])])).stdout);
    assert.equal(result.status, failAt === 1 ? 'refused' : 'outcome_unknown');
    assert.equal(result.attempts, failAt - 1);
    assert.equal(await readFile(join(f.root,'effect.txt'),'utf8').catch(()=>null), failAt === 1 ? null : 'once');
    assert.equal((await dispatch(f.root,p,start,f.adapters)).reason, failAt === 1 ? 'daily_limit' : 'outcome_unknown');
    assert.equal(executions(f),0);
  }
});
