import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createAutomationHostChecks } from "../scripts/lib/orion-automation-host.mjs";
import { initializeAutomationDispatch, dispatchAutomation } from "../scripts/lib/orion-automation-dispatch.mjs";

const action = () => ({ name: "agenda_today", argv: ["orion-agenda", "today"], installationId: "fixture-1" });
function fixture() {
  const state = { map: {
    dist: "/fixture/home/.openclaw/extensions/orion-control/dist", mode: "guarded",
    profileSource: "permission-state.json", modeSource: "strictness.json",
    exec: { security: "allowlist", ask: "off", askFallback: "deny" },
    availability: [{ tier: "automation", available: true, unresolved: false, configOn: true, profileOn: true }],
    capabilities: [{ kind: "command", name: "orion-agenda", pattern: "/fixture/repo/scripts/orion-agenda", level: "AUTO", subs: [] }],
  }, session: { ok: true, status: "none" }, legacy: { session: null }, calls: [] };
  const checks = createAutomationHostChecks({ repoRoot: "/fixture/repo", homeRoot: "/fixture/home", now: () => 1000,
    run: async (file, args, options) => {
      state.calls.push({ file, args, options });
      if (state.error) throw new Error("host unavailable");
      if (state.sessionError && file.endsWith("orion-session")) throw new Error("session unavailable");
      if (state.malformed === file.split("/").at(-1)) return { stdout: "{truncated" };
      return { stdout: JSON.stringify(file.endsWith("orion-authority") ? state.map : state.session) };
    }, read: async () => { if (state.readError) throw state.readError; return JSON.stringify(state.legacy); },
  });
  return { state, checks };
}
test("host probes fixed read-only commands with bounded output and host socket", async () => {
  const { state, checks } = fixture();
  assert.deepEqual(await checks.readContext(), { now: 1000, effectiveMode: "guarded", focusActive: false });
  assert.equal(await checks.authorize(action()), true);
  assert.deepEqual(state.calls.map(c => [c.file, c.args]), [
    ["/fixture/repo/scripts/orion-authority", ["show", "--json"]],
    ["/fixture/repo/scripts/orion-session", ["status", "--json"]],
    ["/fixture/repo/scripts/orion-authority", ["show", "--json"]],
  ]);
  for (const { options } of state.calls) {
    assert.equal(options.timeout, 15000); assert.equal(options.maxBuffer, 2097152);
    assert.equal(options.env.ORION_SESSION_SOCKET, "/fixture/home/.openclaw/orion-session.sock");
  }
  assert.equal(checks.execute, undefined); assert.equal(checks.deliver, undefined);
});
test("authority is freshly read and revocation immediately denies", async () => {
  const { state, checks } = fixture();
  assert.equal(await checks.authorize(action()), true);
  state.map.capabilities[0].level = "NEVER";
  assert.equal(await checks.authorize(action()), false);
});
test("unsupported actions and changed argv never consult authority", async () => {
  const { state, checks } = fixture();
  for (const input of [null, { ...action(), name: "standing_check" }, { ...action(), name: "daily_rollup" },
    { ...action(), argv: ["orion-agenda", "remove"] }, { ...action(), argv: [...action().argv, "--notify"] },
    { ...action(), installationId: "" }]) assert.equal(await checks.authorize(input), false);
  assert.equal(state.calls.length, 0);
});
test("fallback catalogs, overrides, unknown mode and unsafe execution policies fail closed", async () => {
  for (const mutate of [m => m.dist = "/fixture/repo/plugin/orion-control/dist", m => m.mode = "unknown",
    m => m.modeSource = "--mode override", m => m.profileSource = "--profile override",
    m => m.exec.security = "full", m => m.exec.askFallback = "allow", m => m.exec.ask = "always",
    m => m.capabilities = null]) {
    const { state, checks } = fixture(); mutate(state.map);
    assert.equal(await checks.authorize(action()), false);
    await assert.rejects(checks.readContext());
  }
});
test("disabled, ambiguous, approval-required and mismatched capabilities are refused", async () => {
  for (const mutate of [m => m.availability[0].available = false, m => m.availability[0].configOn = false,
    m => m.availability[0].profileOn = false, m => m.availability[0].unresolved = true,
    m => m.availability.push(m.availability[0]), m => m.capabilities.push(m.capabilities[0]),
    m => m.capabilities[0].pattern = "/other/orion-agenda", m => m.capabilities[0].level = "APPROVAL",
    m => m.capabilities[0].level = "NOTIFY", m => m.capabilities[0].escapeHatch = true,
    m => m.capabilities[0].subs = [{ name: "today", level: "AUTO" }], m => m.capabilities = []]) {
    const { state, checks } = fixture(); mutate(state.map);
    assert.equal(await checks.authorize(action()), false);
  }
});
test("native focus phases protect whole session; unknown replies remain unknown", async () => {
  for (const status of ["running", "paused", "waiting-for-return", "finishing"]) {
    const { state, checks } = fixture(); state.session.status = status;
    assert.equal((await checks.readContext()).focusActive, true);
  }
  for (const session of [null, {}, { ok: false, status: "none" }, { ok: true, status: "mystery" },
    { ok: true, status: "none", unreadable: "corrupt" }]) {
    const { state, checks } = fixture(); state.session = session;
    assert.equal((await checks.readContext()).focusActive, null);
  }
});
test("legacy active sessions are respected; corrupt legacy state cannot imply inactive", async () => {
  const { state, checks } = fixture();
  state.legacy = { session: { until: 1000 } }; assert.equal((await checks.readContext()).focusActive, true);
  state.legacy.session.until = 999; assert.equal((await checks.readContext()).focusActive, false);
  state.legacy = {}; assert.equal((await checks.readContext()).focusActive, null);
  state.readError = new Error("unreadable"); assert.equal((await checks.readContext()).focusActive, null);
  state.readError.code = "ENOENT"; assert.equal((await checks.readContext()).focusActive, false);
});
test("host command failure prevents authorization and context admission", async () => {
  const { state, checks } = fixture(); state.error = true;
  assert.equal(await checks.authorize(action()), false);
  await assert.rejects(checks.readContext());
});
test("broken native probe leaves focus unknown unless legacy is positively active", async () => {
  const { state, checks } = fixture(); state.sessionError = true;
  assert.equal((await checks.readContext()).focusActive, null);
  assert.equal(await checks.authorize(action()), true);
  state.legacy = { session: { until: 2000 } };
  assert.equal((await checks.readContext()).focusActive, true);
});
test("malformed probe JSON fails closed while resolved expired delegation remains usable", async () => {
  const { state, checks } = fixture(); state.malformed = "orion-session";
  assert.equal((await checks.readContext()).focusActive, null);
  state.malformed = "orion-authority";
  assert.equal(await checks.authorize(action()), false); await assert.rejects(checks.readContext());
  state.malformed = null; state.map.modeSource = "strictness.json (the sovereign delegation expired)";
  assert.equal((await checks.readContext()).effectiveMode, "guarded");
});
test("dispatcher with host checks withholds unknown focus then permits one fixture effect", async t => {
  const root = await mkdtemp(join(tmpdir(), "orion-host-integration-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const record = { name: "host-test", installationId: "fixture-1", timeZone: "UTC", expiresOn: "2026-12-31",
    trigger: { kind: "hourly", atMinute: 0 }, conditions: { skipDuringFocus: true }, action: "agenda_today",
    permissions: { expectsMode: "guarded" }, riskLimits: { maxRunsPerDay: 1 }, failureBehavior: "stop" };
  await initializeAutomationDispatch(root, record);
  const { state, checks } = fixture(); let effects = 0;
  const adapters = { ...checks, execute: async () => { effects++; return { ok: true }; } };
  state.sessionError = true;
  const refused = await dispatchAutomation(root, record, 0, adapters);
  assert.equal(refused.status, "refused"); assert.equal(effects, 0);
  state.sessionError = false;
  assert.equal((await dispatchAutomation(root, record, 0, adapters)).status, "succeeded");
  assert.equal(effects, 1);
  assert.equal((await dispatchAutomation(root, record, 0, adapters)).reason, "duplicate_or_old_trigger");
});
