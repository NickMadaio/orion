import test from "node:test";
import assert from "node:assert/strict";
import { rowFromTrajectory, report, sourceOf, priceFor } from "../scripts/lib/usage/usage.mjs";

const ev = (over) => ({ type: "model.completed", ts: "2026-10-07T10:00:00Z", provider: "anthropic", modelId: "claude-haiku-4-5-20251001",
  sessionKey: "agent:main:orion-chat-1", data: { usage: { input: 10, output: 1000, cacheRead: 1_000_000, cacheWrite: 100_000 }, promptCache: { retention: "long" } }, ...over });

test("prices a Haiku call with a 1-hour cache write", () => {
  const r = rowFromTrajectory(ev());
  // 10*1 + 1000*5 + 1e6*0.1 + 1e5*2  = 10 + 5000 + 100000 + 200000 per million
  assert.equal(r.cost.toFixed(6), (305010 / 1e6).toFixed(6));
  assert.equal(r.local, false);
  assert.equal(r.source, "mac chat");
});

test("a 5-minute cache write is cheaper, and local models are free", () => {
  assert.ok(rowFromTrajectory(ev({ data: { usage: { cacheWrite: 1e6 }, promptCache: { retention: "short" } } })).cost === 1.25);
  const local = rowFromTrajectory(ev({ provider: "ollama", modelId: "qwen3.5:9b" }));
  assert.equal(local.cost, 0); assert.equal(local.local, true);
  assert.equal(priceFor("claude-sonnet-5").output, 10);
});

test("other events are ignored", () => assert.equal(rowFromTrajectory({ type: "session.started" }), null));

test("sources come from the session key", () => {
  assert.equal(sourceOf("agent:main:orion-eval-sched-1"), "tests");
  assert.equal(sourceOf("agent:main:claude-check-1"), "checks");
  assert.equal(sourceOf("agent:main:orion-app-v2"), "phone");
});

test("the report splits periods and projects the month from real use only", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const rows = [
    { ...rowFromTrajectory(ev({ ts: "2026-10-10T09:00:00Z" })) },
    { ...rowFromTrajectory(ev({ ts: "2026-10-02T09:00:00Z", sessionKey: "orion-eval-sched-x" })) },
    { ...rowFromTrajectory(ev({ ts: "2026-09-20T09:00:00Z" })) },
  ];
  const r = report(rows, { now });
  assert.equal(r.today.calls, 1);
  assert.equal(r.month.calls, 2);
  assert.equal(r.week.calls, 1);
  assert.ok(r.projection.monthReal < r.projection.monthAll, "tests are left out of the real projection");
  assert.equal(r.daily.length, 14);
  assert.throws(() => report(rows, {}), TypeError);
});
