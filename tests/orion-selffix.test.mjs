import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { writeFixtureDir } from "./selfcheck-fixture.mjs";

const BIN = join(import.meta.dirname, "..", "scripts", "orion-selffix");
const DIAG = {
  kind: "wrong-tool", signature: "wrong-tool:app_open", cause: "a site was routed as an app", title: "Fix: wrong tool on \"open amazon uk\"",
  says: "I treated \"amazon uk\" as an app name.", fixable: true,
  failingExample: { message: "open amazon uk", reply: "I could not do that.", tool: "app_open", args: "{}", error: "not found", route: { move: "tool" } },
  files: ["plugin/orion-control/src/open-request.ts", "plugin/orion-control/src/open-request.test.ts"],
};

function world(now = "2026-11-04T14:00:00Z") {
  const dir = mkdtempSync(join(tmpdir(), "selffix-"));
  const calls = join(dir, "projects-calls.log");
  const fake = join(dir, "fake-projects");
  writeFileSync(fake, `#!/usr/bin/env node\nimport { appendFileSync } from "node:fs";\nappendFileSync(${JSON.stringify(calls)}, process.argv.slice(2).join(" ") + "\\n");\nconst [cmd] = process.argv.slice(2);\nif (cmd === "add" && process.env.FAKE_ADD_SLOW) await new Promise((r) => setTimeout(r, 600));
if (cmd === "add") console.log(JSON.stringify({ id: "project-fake1", name: "x", lint: { errors: 0 } }));\nelse if (cmd === "launch" && process.env.FAKE_LAUNCH_FAIL) { console.error("A project is running or has an uncertain worker."); process.exit(1); }\nelse console.log(JSON.stringify({ launched: true, pid: 1 }));\n`);
  chmodSync(fake, 0o755);
  const vault = join(dir, "vault");
  const env = { ...process.env, ORION_CONTROLLED_DIR: dir, ORION_NOW: now, TZ: "UTC", ORION_PROJECTS_BIN: fake, ORION_BRAIN_VAULT: vault, ORION_REACH_BIN: join(dir, "no-reach") };
  const run = (args, extra = {}, input) => { const r = spawnSync(process.execPath, [BIN, ...args], { encoding: "utf8", env: { ...env, ...extra }, input }); return { ...r, out: (() => { try { return JSON.parse(r.stdout.trim().split("\n").at(-1)); } catch { return null; } })() }; };
  const state = () => JSON.parse(readFileSync(join(dir, "selffix.json"), "utf8"));
  const projectCalls = () => (existsSync(calls) ? readFileSync(calls, "utf8").trim().split("\n") : []);
  const runAsync = (args, extra = {}) => new Promise((resolve) => { const c = spawn(process.execPath, [BIN, ...args], { env: { ...env, ...extra } }); let out = ""; let err = ""; c.stdout.on("data", (d) => (out += d)); c.stderr.on("data", (d) => (err += d)); c.on("close", (code) => resolve({ code, out, err })); });
  return { dir, run, runAsync, state, projectCalls, vault };
}
const propose = (w, d = DIAG) => w.run(["propose", "--stdin"], {}, JSON.stringify(d));

test("propose records an offer and creates no project", () => {
  const w = world();
  const r = propose(w);
  assert.equal(r.status, 0, r.stderr);
  assert.equal(r.out.status, "offered");
  assert.match(r.out.item.id, /^sf-[0-9a-f]{6}$/);
  assert.deepEqual(w.projectCalls(), []);
});

test("a second proposal for the same issue is a duplicate, not a second project", () => {
  const w = world();
  const first = propose(w).out.item;
  const again = propose(w);
  assert.equal(again.out.status, "duplicate");
  assert.equal(again.out.item.id, first.id);
  assert.equal(w.state().items.length, 1);
});

test("now: registers the plan, launches the run, and records the project", () => {
  const w = world();
  const id = propose(w).out.item.id;
  const r = w.run(["accept", id, "--now"]);
  assert.equal(r.out.status, "started");
  assert.equal(r.out.projectId, "project-fake1");
  const calls = w.projectCalls();
  assert.match(calls[0], /^add .*plan\.md /);
  assert.equal(calls[1], "launch project-fake1 --until-stopped");
  assert.equal(w.state().items[0].status, "started");
  assert.ok(existsSync(join(w.dir, "selffix", id, "plan.md")));
  assert.ok(existsSync(join(w.dir, "selffix", id, "plan.briefs", "common.md")));
});

test("now when another project is running: the project is created and parked with a reminder, not lost", () => {
  const w = world();
  const id = propose(w).out.item.id;
  const r = w.run(["accept", id, "--now"], { FAKE_LAUNCH_FAIL: "1" });
  assert.equal(r.out.status, "parked");
  assert.match(r.out.reason, /running/);
  assert.equal(w.state().items[0].projectId, "project-fake1");
  assert.ok(r.out.remindAt);
});

test("later: the project is created but never launched, and a reminder is scheduled", () => {
  const w = world();
  const id = propose(w).out.item.id;
  const r = w.run(["accept", id, "--later", "--at", "2026-11-04T20:30:00Z"]);
  assert.equal(r.out.status, "parked");
  assert.deepEqual(w.projectCalls().map((c) => c.split(" ")[0]), ["add"]);
  const reminders = JSON.parse(readFileSync(join(w.dir, "reminders.json"), "utf8"));
  assert.equal(reminders.length, 1);
  assert.equal(reminders[0].dueAt, Date.parse("2026-11-04T20:30:00Z"));
  assert.equal(reminders[0].label, "the fix project for 'open amazon uk' is waiting. Start it?");
  assert.equal(w.state().items[0].remindAt, "2026-11-04T20:30:00.000Z");
});

test("later with no time picks this evening, or tomorrow evening once it is late", () => {
  const early = world("2026-11-04T14:00:00Z");
  const a = early.run(["accept", propose(early).out.item.id, "--later"]).out;
  assert.equal(a.remindAt, "2026-11-04T19:30:00.000Z");
  const late = world("2026-11-04T22:10:00Z");
  const b = late.run(["accept", propose(late).out.item.id, "--later"]).out;
  assert.equal(b.remindAt, "2026-11-05T19:30:00.000Z");
});

test("start launches a parked project and clears its reminder", () => {
  const w = world();
  const id = propose(w).out.item.id;
  w.run(["accept", id, "--later"]);
  const r = w.run(["start", id]);
  assert.equal(r.out.status, "started");
  assert.deepEqual(w.projectCalls().map((c) => c.split(" ")[0]), ["add", "launch"]);
  assert.equal(JSON.parse(readFileSync(join(w.dir, "reminders.json"), "utf8")).length, 0);
});

test("no: drops it, records the decision, creates nothing, and does not re-offer it", () => {
  const w = world();
  const id = propose(w).out.item.id;
  const r = w.run(["decline", id]);
  assert.equal(r.out.status, "declined");
  assert.deepEqual(w.projectCalls(), []);
  assert.equal(w.state().items[0].status, "declined");
  assert.equal(propose(w).out.status, "declined-before");
});

test("accept refuses an item that is not waiting for an answer", () => {
  const w = world();
  const id = propose(w).out.item.id;
  w.run(["decline", id]);
  assert.equal(w.run(["accept", id, "--now"]).status, 3);
  assert.equal(w.run(["accept", "sf-000000", "--now"]).status, 3);
});

test("it will not touch the real project library from an isolated run", () => {
  const w = world();
  const id = propose(w).out.item.id;
  const r = w.run(["accept", id, "--now"], { ORION_PROJECTS_BIN: "" });
  assert.equal(r.status, 3);
  assert.match(r.stderr, /isolated/);
});

test("nightly scan writes an own note to the vault and keeps one candidate", () => {
  const w = world("2026-11-05T01:00:00Z");
  writeFixtureDir(w.dir, { day: "2026-11-04" });
  const note = join(w.vault, "10 Projects");
  assert.equal(spawnSync("mkdir", ["-p", note]).status, 0);
  writeFileSync(join(note, "ORION.md"), "---\ntitle: ORION\n---\n\n# ORION\n");
  const r = w.run(["scan-night", "--day", "2026-11-04"]);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.out.failures >= 1);
  assert.equal(r.out.candidate.signature, "wrong-tool:app_open");
  const text = readFileSync(join(note, "ORION.md"), "utf8");
  assert.match(text, /\[self-review\].*wrong-tool.*#orion \(2026-11-04\)/s);
  assert.equal(w.state().items.filter((i) => i.status === "candidate").length, 1);
  const again = w.run(["scan-night", "--day", "2026-11-04"]);
  assert.equal(w.state().items.length, 1);
  assert.equal(again.out.candidate.signature, "wrong-tool:app_open");
});

test("nightly scan with nothing wrong says so and adds nothing", () => {
  const w = world("2026-11-05T01:00:00Z");
  const r = w.run(["scan-night", "--day", "2026-11-04"]);
  assert.equal(r.out.failures, 0);
  assert.equal(r.out.candidate, null);
});

test("morning offer: one a day at most, only for a candidate, and it asks now or later", () => {
  const w = world("2026-11-05T01:00:00Z");
  writeFixtureDir(w.dir, { day: "2026-11-04" });
  w.run(["scan-night", "--day", "2026-11-04"]);
  const morning = { ORION_NOW: "2026-11-05T09:30:00Z" };
  const dry = w.run(["offer-morning"], morning);
  assert.equal(dry.out.offered, true);
  assert.match(dry.out.text, /I can open a fix project for this\. Start on it now, or later\?/);
  assert.equal(w.state().items[0].status, "offered");
  const second = w.run(["offer-morning"], morning);
  assert.equal(second.out.offered, false);
  assert.equal(second.out.why, "already offered today");
});

test("morning offer waits for the morning and for there to be something worth fixing", () => {
  const w = world("2026-11-05T01:00:00Z");
  assert.equal(w.run(["offer-morning"], { ORION_NOW: "2026-11-05T09:30:00Z" }).out.why, "nothing to offer");
  writeFixtureDir(w.dir, { day: "2026-11-04" });
  w.run(["scan-night", "--day", "2026-11-04"]);
  assert.equal(w.run(["offer-morning"], { ORION_NOW: "2026-11-05T05:00:00Z" }).out.why, "not morning yet");
});

test("a candidate matching an already open fix project is not offered", () => {
  const w = world("2026-11-05T01:00:00Z");
  writeFixtureDir(w.dir, { day: "2026-11-04" });
  const id = propose(w).out.item.id;
  w.run(["accept", id, "--later"]);
  const r = w.run(["scan-night", "--day", "2026-11-04"]);
  assert.notEqual(r.out.candidate?.signature, "wrong-tool:app_open");
  assert.equal(w.state().items.filter((i) => i.signature === "wrong-tool:app_open").length, 1);
});

test("later again to the reminder re-parks the same project with one reminder", () => {
  const w = world();
  const id = propose(w).out.item.id;
  w.run(["accept", id, "--later", "--at", "2026-11-04T20:30:00Z"]);
  const again = w.run(["accept", id, "--later", "--at", "2026-11-05T09:00:00Z"]);
  assert.equal(again.out.status, "parked");
  assert.equal(w.projectCalls().filter((c) => c.startsWith("add")).length, 1);
  const reminders = JSON.parse(readFileSync(join(w.dir, "reminders.json"), "utf8"));
  assert.deepEqual(reminders.map((r) => r.dueAt), [Date.parse("2026-11-05T09:00:00Z")]);
});

test("the project id is saved right after add, so a crash before launch cannot make a second project", () => {
  const w = world();
  const id = propose(w).out.item.id;
  const crashed = w.run(["accept", id, "--now"], { ORION_SELFFIX_CRASH_AFTER_ADD: "1" });
  assert.notEqual(crashed.status, 0);
  assert.equal(w.state().items[0].projectId, "project-fake1");
  assert.equal(w.state().items[0].status, "offered");
  const retry = w.run(["accept", id, "--now"]);
  assert.equal(retry.out.status, "started");
  assert.deepEqual(w.projectCalls().map((c) => c.split(" ")[0]), ["add", "launch"]);
});

test("two quick answers at once create exactly one project", async () => {
  const w = world();
  const id = propose(w).out.item.id;
  const [a, b] = await Promise.all([w.runAsync(["accept", id, "--now"], { FAKE_ADD_SLOW: "1" }), w.runAsync(["accept", id, "--now"], { FAKE_ADD_SLOW: "1" })]);
  assert.equal(w.projectCalls().filter((c) => c.startsWith("add")).length, 1);
  assert.equal(w.projectCalls().filter((c) => c.startsWith("launch")).length, 1);
  assert.deepEqual([a.code, b.code].sort(), [0, 3]);
});

test("a held lock refuses the action and creates nothing; a stale lock is taken over", () => {
  const w = world();
  const id = propose(w).out.item.id;
  mkdirSync(join(w.dir, "selffix.lock"));
  writeFileSync(join(w.dir, "selffix.lock", "owner"), JSON.stringify({ pid: process.pid, at: Date.now() }));
  const held = w.run(["accept", id, "--now"]);
  assert.equal(held.status, 3);
  assert.match(held.stderr, /in progress/);
  assert.deepEqual(w.projectCalls(), []);
  const old = new Date(Date.now() - 10 * 60_000);
  writeFileSync(join(w.dir, "selffix.lock", "owner"), JSON.stringify({ pid: 999999, at: old.getTime() }));
  utimesSync(join(w.dir, "selffix.lock"), old, old);
  assert.equal(w.run(["accept", id, "--now"]).out.status, "started");
});

test("propose --requested overrides a recent decline: he asked for the fix just now", () => {
  const w = world();
  const id = propose(w).out.item.id;
  w.run(["decline", id]);
  assert.equal(propose(w).out.status, "declined-before");
  const r = w.run(["propose", "--stdin", "--requested"], {}, JSON.stringify(DIAG));
  assert.equal(r.out.status, "offered");
});

test("propose --requested still reports an open fix as a duplicate (one project, never two)", () => {
  const w = world();
  const first = propose(w).out.item;
  const r = w.run(["propose", "--stdin", "--requested"], {}, JSON.stringify(DIAG));
  assert.equal(r.out.status, "duplicate");
  assert.equal(r.out.item.id, first.id);
});
