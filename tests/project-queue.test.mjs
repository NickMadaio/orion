// orion-project-queue: projects run one after another; a stop stops the queue (2026-10-05).
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const QUEUE = join(ROOT, "scripts/orion-project-queue");
const FAKE = join(ROOT, "tests/fixtures/fake-projects.mjs");

function world(t, extra = {}) {
  const dir = mkdtempSync(join(tmpdir(), "orion-queue-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  writeFileSync(join(dir, "projects.json"), JSON.stringify([{ id: "p-a", name: "Alpha" }, { id: "p-b", name: "Beta" }, { id: "p-c", name: "Gamma" }]));
  const env = { ...process.env, ORION_PROJECT_AGENT_ROOT: dir, ORION_PROJECTS_BIN: FAKE, ORION_QUEUE_POLL_MS: "50",
    FAKE_PROJECTS: join(dir, "projects.json"), FAKE_LAUNCHES: join(dir, "launches.txt"), ...extra };
  const run = (...a) => spawnSync(process.execPath, [QUEUE, ...a], { encoding: "utf8", env });
  const launches = () => (existsSync(join(dir, "launches.txt")) ? readFileSync(join(dir, "launches.txt"), "utf8").trim().split("\n") : []);
  const queue = () => JSON.parse(readFileSync(join(dir, "queue.json"), "utf8"));
  return { run, launches, queue };
}
const settle = async (q, want) => { for (let i = 0; i < 200; i += 1) { if (want(q())) return; await new Promise((r) => setTimeout(r, 50)); } };

test("queued projects run in order, each after the last one ends", async (t) => {
  const w = world(t);
  assert.equal(w.run("start", "Alpha", "p-b", "gamma").status, 0);
  await settle(w.queue, (q) => q.status === "done");
  assert.deepEqual(w.launches(), ["p-a", "p-b", "p-c"]);
  assert.ok(w.queue().items.every((i) => i.state === "finished"));
});

test("a project Nick stopped stops the queue there", async (t) => {
  const w = world(t, { FAKE_HALT: "p-a" });
  w.run("start", "Alpha", "Beta");
  await settle(w.queue, (q) => q.status === "stopped");
  assert.deepEqual(w.launches(), ["p-a"]);
  assert.equal(w.queue().items[1].state, "queued");
});

test("an unknown project is refused and nothing starts", (t) => {
  const w = world(t);
  const r = w.run("start", "Alpha", "Nope");
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no project "Nope"/);
  assert.deepEqual(w.launches(), []);
});
