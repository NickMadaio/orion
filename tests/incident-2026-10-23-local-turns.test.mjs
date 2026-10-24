// 2026-10-23: scripts/orion_v2_strictness_check.sh ran `orion-remote handle -- approve A-7F3K` against the real HOME, and every run
// logged a "turn from Nick" in the live inbound-turns.jsonl (12 of its 25 lines, 10-16 to 10-21), which the curiosity loop reads as him
// answering an ask. A `local` command is never his turn; the check now runs under a throwaway HOME. Temp dirs only.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const SCRIPTS = join(import.meta.dirname, "../scripts");

function remote(from, text) {
  const home = mkdtempSync(join(tmpdir(), "orion-local-turn-"));
  const record = join(home, "inbound.args");
  const fake = join(home, "fake-inbound");
  writeFileSync(fake, `#!/usr/bin/env node\nrequire("node:fs").appendFileSync(${JSON.stringify(record)}, JSON.stringify(process.argv.slice(2)) + "\\n");\n`);
  chmodSync(fake, 0o755);
  const brain = join(home, "fake-brain");
  writeFileSync(brain, "#!/bin/sh\necho '{\"result\":{\"payloads\":[{\"text\":\"ok\"}]}}'\n"); chmodSync(brain, 0o755);
  const env = { PATH: process.env.PATH, HOME: home, ORION_REMOTE_ALLOW: from, ORION_BRAIN_BIN: brain, ORION_INBOUND_BIN: fake };
  const r = spawnSync(process.execPath, [join(SCRIPTS, "orion-remote"), "handle", "--from", from, "--", text], { env, encoding: "utf8" });
  return { r, home, logged: existsSync(record) ? readFileSync(record, "utf8").trim().split("\n") : [] };
}

test("a local `approve A-7F3K` is refused and is not logged as a turn from Nick", () => {
  const { r, home, logged } = remote("local", "approve A-7F3K");
  assert.match(r.stdout + r.stderr, /has to come from a person/);
  assert.deepEqual(logged, []);
  assert.ok(!existsSync(join(home, ".openclaw/orion-controlled/inbound-turns.jsonl")));
});

test("the strictness check runs orion-remote under a throwaway HOME, never the live one", () => {
  const sh = readFileSync(join(SCRIPTS, "orion_v2_strictness_check.sh"), "utf8");
  const calls = sh.split("\n").filter((l) => /scripts\/orion-remote"? handle/.test(l));
  assert.ok(calls.length > 0);
  for (const line of calls) assert.match(line, /HOME="\$scratch_home"/);
});
