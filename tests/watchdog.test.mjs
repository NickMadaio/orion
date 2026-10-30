import { test } from "node:test";
import assert from "node:assert/strict";
import { step, emptyState, backoffMs, normalise } from "../scripts/lib/watchdog/machine.mjs";
import { warmBody, warmAll } from "../scripts/lib/watchdog/warm.mjs";
import { runPass } from "../scripts/lib/watchdog/run.mjs";
import { formatStatus } from "../scripts/lib/watchdog/format.mjs";
import { RELAUNCH, ALERT_MIN_GAP_MS } from "../scripts/lib/watchdog/config.mjs";

const T0 = Date.UTC(2030, 0, 1, 12, 0, 0);
const MIN = 60_000;
const ALL_UP = { ollama: true, app: true, link: true, gateway: true };
const OLLAMA_DOWN = { ...ALL_UP, ollama: false };

test("healthy stays healthy with no actions or alerts", () => {
  const r = step(emptyState(), ALL_UP, T0);
  assert.deepEqual(r.actions, []);
  assert.deepEqual(r.alerts, []);
  assert.equal(r.state.components.ollama.status, "up");
});

test("down: relaunch immediately, no alert on first sight", () => {
  const r = step(emptyState(), OLLAMA_DOWN, T0);
  assert.deepEqual(r.actions, [{ type: "relaunch", component: "ollama" }]);
  assert.deepEqual(r.alerts, []);
  assert.equal(r.state.components.ollama.status, "down");
  assert.equal(r.state.components.ollama.attempts, 1);
});

test("still down next pass: alert exactly once, then never again", () => {
  let s = step(emptyState(), OLLAMA_DOWN, T0).state;
  const second = step(s, OLLAMA_DOWN, T0 + MIN);
  assert.deepEqual(second.alerts.map((a) => a.type), ["down"]);
  s = second.state;
  for (let i = 2; i < 40; i++) {
    const r = step(s, OLLAMA_DOWN, T0 + i * MIN);
    assert.deepEqual(r.alerts, [], `pass ${i}`);
    s = r.state;
  }
});

test("self-heal within a pass is silent but still warms", () => {
  const s = step(emptyState(), OLLAMA_DOWN, T0).state;
  const r = step(s, ALL_UP, T0 + MIN);
  assert.deepEqual(r.alerts, []);
  assert.deepEqual(r.actions, [{ type: "warm" }]);
  assert.equal(r.state.components.ollama.status, "up");
});

test("recovery after an alert sends one recovery alert, then nothing", () => {
  let s = step(emptyState(), OLLAMA_DOWN, T0).state;
  s = step(s, OLLAMA_DOWN, T0 + MIN).state;
  const up = step(s, ALL_UP, T0 + 5 * MIN);
  assert.deepEqual(up.alerts.map((a) => a.type), ["recovered"]);
  const after = step(up.state, ALL_UP, T0 + 6 * MIN);
  assert.deepEqual(after.alerts, []);
});

test("a second outage alerts again (dedupe is per outage)", () => {
  let s = step(emptyState(), OLLAMA_DOWN, T0).state;
  s = step(s, OLLAMA_DOWN, T0 + MIN).state;
  s = step(s, ALL_UP, T0 + 2 * MIN).state;
  s = step(s, OLLAMA_DOWN, T0 + 30 * MIN).state;
  const r = step(s, OLLAMA_DOWN, T0 + 31 * MIN);
  assert.deepEqual(r.alerts.map((a) => a.type), ["down"]);
});

test("alert rate limit defers a second component's alert, then sends it", () => {
  let s = step(emptyState(), { ...ALL_UP, ollama: false, gateway: false }, T0).state;
  const first = step(s, { ...ALL_UP, ollama: false, gateway: false }, T0 + MIN);
  assert.equal(first.alerts.length, 1);
  const later = step(first.state, { ...ALL_UP, ollama: false, gateway: false }, T0 + MIN + ALERT_MIN_GAP_MS);
  assert.equal(later.alerts.length, 1);
  assert.notEqual(later.alerts[0].component, first.alerts[0].component);
});

test("backoff doubles and caps; relaunch only when due", () => {
  assert.deepEqual([1, 2, 3, 4, 5, 9].map(backoffMs), [60_000, 120_000, 240_000, 480_000, 900_000, 900_000]);
  let s = step(emptyState(), OLLAMA_DOWN, T0).state; // attempt 1 at T0
  assert.equal(step(s, OLLAMA_DOWN, T0 + 30_000).actions.length, 0);
  const r2 = step(s, OLLAMA_DOWN, T0 + MIN);
  assert.equal(r2.actions.length, 1); // attempt 2 at T0+60s
  s = r2.state;
  assert.equal(step(s, OLLAMA_DOWN, T0 + 2 * MIN).actions.length, 0); // next wait is 120s
  assert.equal(step(s, OLLAMA_DOWN, T0 + 3 * MIN).actions.length, 1);
});

test("app down: relaunch the app, do not kick the link", () => {
  const r = step(emptyState(), { ...ALL_UP, app: false, link: false }, T0);
  assert.deepEqual(r.actions, [{ type: "relaunch", component: "app" }]);
});

test("link down with app up: kick the link", () => {
  const r = step(emptyState(), { ...ALL_UP, link: false }, T0);
  assert.deepEqual(r.actions, [{ type: "relaunch", component: "link" }]);
});

test("gateway down is never acted on, only alerted (a focus session must not be cut)", () => {
  assert.equal("gateway" in RELAUNCH, false);
  let s = emptyState();
  const all = [];
  for (let i = 0; i < 10; i++) {
    const r = step(s, { ...ALL_UP, gateway: false }, T0 + i * MIN);
    all.push(...r.actions);
    s = r.state;
  }
  assert.deepEqual(all, []);
  assert.equal(s.components.gateway.alertedDown, true);
});

test("normalise survives garbage", () => {
  assert.equal(normalise("x").components.ollama.status, "up");
  assert.equal(normalise({ components: { ollama: { status: "down", since: 5 } } }).components.ollama.since, 5);
});

test("warm body shape: exact contexts, 24h keep_alive, empty prompt", () => {
  assert.deepEqual(warmBody({ model: "qwen3.5:9b", num_ctx: 32768 }), {
    model: "qwen3.5:9b", prompt: "", stream: false, think: false, keep_alive: "24h", options: { num_ctx: 32768 },
  });
});

test("warmAll posts both models in order at their contexts", async () => {
  const calls = [];
  const fetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), method: init.method }); return { ok: true, status: 200 }; };
  const res = await warmAll(fetch);
  assert.deepEqual(res.map((r) => r.ok), [true, true]);
  assert.deepEqual(calls.map((c) => [c.body.model, c.body.options.num_ctx, c.body.keep_alive]), [
    ["qwen3.5:4b-q4_K_M", 16384, "24h"],
    ["qwen3.5:9b", 32768, "24h"],
  ]);
  assert.ok(calls.every((c) => c.method === "POST" && c.url.endsWith("/api/generate")));
});

test("warmAll reports failures without throwing", async () => {
  const res = await warmAll(async () => { throw new Error("boom"); });
  assert.deepEqual(res.map((r) => r.ok), [false, false]);
});

// ---- runPass with injected I/O ----
function world({ up = ALL_UP, state = null, warmOk = true } = {}) {
  const log = { runs: [], fetches: [], notes: [], written: null };
  const deps = {
    uid: 501,
    now: () => T0,
    readState: async () => state,
    writeState: async (s) => { log.written = s; },
    notify: async (event, text) => { log.notes.push({ event, text }); },
    run: async (cmd, args) => {
      log.runs.push([cmd, ...args]);
      if (cmd.endsWith("pgrep")) return { code: up.app ? 0 : 1, stdout: "" };
      if (args[0] === "print") return { code: up.link ? 0 : 113, stdout: up.link ? "state = running" : "" };
      return { code: 0, stdout: "" };
    },
    fetch: async (url, init) => {
      log.fetches.push({ url, method: init?.method ?? "GET" });
      if (url.includes("11434") && !url.includes("/api/generate")) return { ok: up.ollama };
      if (url.includes("/api/generate")) return { ok: warmOk, status: warmOk ? 200 : 500 };
      return { ok: up.gateway };
    },
  };
  return { deps, log };
}

test("runPass: ollama down relaunches the app via open, writes state", async () => {
  const { deps, log } = world({ up: OLLAMA_DOWN });
  const r = await runPass(deps);
  assert.ok(log.runs.some((c) => c.join(" ") === "/usr/bin/open -g -a Ollama"));
  assert.equal(log.written.components.ollama.status, "down");
  assert.equal(r.warm, null);
});

test("runPass: after recovery warms both models and clears pendingWarm", async () => {
  const down = step(emptyState(), OLLAMA_DOWN, T0 - 2 * MIN).state;
  const { deps, log } = world({ state: down });
  const r = await runPass(deps);
  assert.equal(r.warm.length, 2);
  assert.equal(log.written.pendingWarm, false);
  assert.equal(log.fetches.filter((f) => f.method === "POST").length, 2);
});

test("runPass: failed warm stays pending for the next pass", async () => {
  const down = step(emptyState(), OLLAMA_DOWN, T0 - 2 * MIN).state;
  const { deps, log } = world({ state: down, warmOk: false });
  await runPass(deps);
  assert.equal(log.written.pendingWarm, true);
});

test("runPass: alert goes through orion-notify vocabulary (blocked / complete)", async () => {
  let state = step(emptyState(), OLLAMA_DOWN, T0 - 3 * MIN).state;
  const a = world({ up: OLLAMA_DOWN, state });
  await runPass(a.deps);
  assert.deepEqual(a.log.notes.map((n) => n.event), ["blocked"]);
  const b = world({ state: a.log.written });
  await runPass(b.deps);
  assert.deepEqual(b.log.notes.map((n) => n.event), ["complete"]);
});

test("runPass: notify failure is reported, not thrown", async () => {
  const state = step(emptyState(), OLLAMA_DOWN, T0 - 3 * MIN).state;
  const { deps } = world({ up: OLLAMA_DOWN, state });
  deps.notify = async () => { throw new Error("no channel"); };
  const r = await runPass(deps);
  assert.match(r.errors[0], /alert: no channel/);
});

test("runPass --dry-run: no relaunch, no warm, no notify, no state write", async () => {
  const { deps, log } = world({ up: { ...OLLAMA_DOWN, gateway: false } });
  const r = await runPass(deps, { dryRun: true });
  assert.equal(r.dryRun, true);
  assert.deepEqual(r.actions, [{ type: "relaunch", component: "ollama" }]);
  assert.equal(log.written, null);
  assert.deepEqual(log.notes, []);
  assert.ok(!log.runs.some((c) => c[0] === "/usr/bin/open"));
  assert.ok(!log.fetches.some((f) => f.method === "POST"));
});

test("runPass: gateway down never runs a command against the gateway", async () => {
  const { deps, log } = world({ up: { ...ALL_UP, gateway: false } });
  await runPass(deps);
  await runPass({ ...deps, readState: async () => log.written });
  assert.ok(!log.runs.some((c) => c.join(" ").includes("openclaw") || c.includes("kickstart")));
});

test("formatStatus shows what is down and since when", () => {
  const s = step(emptyState(), OLLAMA_DOWN, T0).state;
  const out = formatStatus(s, T0 + 90 * MIN);
  assert.match(out, /Ollama\s+DOWN\s+since 2030-01-01T12:00:00.000Z \(1 h 30 min\); 1 relaunch/);
  assert.match(out, /Gateway\s+up/);
});
