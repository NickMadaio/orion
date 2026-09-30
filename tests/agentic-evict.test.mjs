// 2026-09-30: the ORION truthful project stopped on "could not evict gpt-oss:20b
// before loading qwen3.6:27b" — three attempts spent in three seconds, because
// the unload was checked once, instantly, and the failure counted against the task.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { ModelRuntime } from "../scripts/lib/agentic/models.mjs";

function fakeOllama(t, { stubbornChecks }) {
  let checks = 0; let unloads = 0;
  const server = createServer((req, res) => {
    let body = ""; req.on("data", (c) => { body += c; });
    req.on("end", () => {
      if (req.url === "/api/ps") {
        checks += 1;
        const models = checks <= stubbornChecks ? [{ name: "gpt-oss:20b", size: 12e9 }] : [];
        res.end(JSON.stringify({ models }));
      } else if (req.url === "/api/generate") { unloads += 1; res.end(JSON.stringify({ done: true })); }
      else { res.statusCode = 404; res.end(); }
    });
  });
  t.after(() => server.close());
  return new Promise((resolve) => server.listen(0, () => resolve({
    endpoint: `http://127.0.0.1:${server.address().port}`, counts: () => ({ checks, unloads }) })));
}
const runtime = (endpoint, extra = {}) => new ModelRuntime({ endpoint, evictPollMs: 10, evictWaitMs: 500, ...extra,
  roles: { worker: { model: "qwen3.6:27b", think: false, contextTokens: 4096 } } });

test("a model that takes a moment to unload is waited for, not failed on", async (t) => {
  const { endpoint, counts } = await fakeOllama(t, { stubbornChecks: 4 });
  const handoff = await runtime(endpoint).ensureExclusive("worker");
  assert.deepEqual(handoff.evicted, ["gpt-oss:20b"]);
  assert.ok(counts().unloads >= 2, "it asks again while waiting");
});

test("a model that never unloads is a recoverable machine problem, not a failed task", async (t) => {
  const { endpoint } = await fakeOllama(t, { stubbornChecks: Infinity });
  await assert.rejects(runtime(endpoint, { evictWaitMs: 50 }).ensureExclusive("worker"),
    (error) => /could not evict gpt-oss:20b/.test(error.message) && error.recoverableRuntime === true);
});
