import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const cli = fileURLToPath(new URL("../scripts/orion-replay", import.meta.url));
const run = (...args) => spawnSync(process.execPath, [cli, ...args], { encoding: "utf8", timeout: 120_000 });
const corpus = (cases) => { const dir = mkdtempSync(join(tmpdir(), "replay-cli-")); writeFileSync(join(dir, "x.cases.json"), JSON.stringify(cases)); return dir; };

test("the repo's anonymised cases pass: only expected failures, and the count is printed", () => {
  const r = run();
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /\d+ expected-fail \(known audit bugs\)/);
  assert.match(r.stdout, /orion-replay: ok/);
});

test("a case that is not expected to fail and does fail turns the run red", () => {
  const dir = corpus([{ id: "x-regression", say: "thanks", expect: { route: "schedule" }, recorded: { desk: { move: "answer", answer: "You're welcome." } } }]);
  const r = run("--private", "--corpus", dir, "--only", "x-regression");
  assert.equal(r.status, 1, r.stdout);
  assert.match(r.stdout, /REGRESSION/);
  assert.match(r.stdout, /route: wanted schedule/);
});

test("an expected failure keeps it green, and --strict flags a surprise pass", () => {
  const known = corpus([{ id: "x-known", say: "thanks", expect: { route: "schedule" }, expectFail: { why: "open bug stands in for this case" }, recorded: { desk: { move: "answer", answer: "You're welcome." } } }]);
  assert.equal(run("--private", "--corpus", known, "--only", "x-known").status, 0);
  const fixed = corpus([{ id: "x-fixed", say: "thanks", expect: { route: "desk-answer" }, expectFail: { why: "was broken, now fixed" }, recorded: { desk: { move: "answer", answer: "You're welcome." } } }]);
  assert.equal(run("--private", "--corpus", fixed, "--only", "x-fixed").status, 0);
  const strict = run("--private", "--corpus", fixed, "--only", "x-fixed", "--strict");
  assert.equal(strict.status, 1);
  assert.match(strict.stdout, /XPASS/);
});
