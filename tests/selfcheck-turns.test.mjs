import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFixtureDir } from "./selfcheck-fixture.mjs";
import { loadSources, buildTurns, recentTurns, redact } from "../scripts/lib/selfcheck/turns.mjs";

const fresh = () => { const dir = mkdtempSync(join(tmpdir(), "selfcheck-")); return { dir, ...writeFixtureDir(dir) }; };

test("turns pair each message with his reply, route and tool steps", () => {
  const { dir } = fresh();
  const turns = buildTurns(loadSources(dir, { sinceMs: 0 }));
  assert.equal(turns.length, 4);
  const open = turns.find((t) => t.message === "open amazon uk");
  assert.match(open.reply, /couldn't run that lookup/);
  assert.equal(open.route.move, "tool");
  assert.equal(open.route.tool, "app_open");
  assert.equal(open.tools.length, 1);
  assert.equal(open.tools[0].action, "app_open");
  assert.equal(open.tools[0].status, "failed_permanent");
  assert.match(open.tools[0].error, /not found/);
});

test("a message with no reply before the next one is marked dropped; the clean turn has no tools", () => {
  const { dir } = fresh();
  const turns = buildTurns(loadSources(dir, { sinceMs: 0 }));
  assert.equal(turns.find((t) => t.message === "remind me to call mum").reply, "");
  assert.equal(turns.find((t) => t.message === "whats on my plan").tools.length, 0);
  assert.equal(turns.find((t) => t.message === "whats on my plan").route.flow, "day-read");
});

test("secrets in tool arguments never reach the summary", () => {
  const { dir, secret } = fresh();
  const text = JSON.stringify(buildTurns(loadSources(dir, { sinceMs: 0 })));
  assert.equal(text.includes(secret), false);
  assert.match(text, /\[redacted\]/);
  assert.equal(redact("Bearer abcdefghijklmnop12345"), "Bearer [redacted]");
});

test("recentTurns keeps the last n and can leave out the current message", () => {
  const { dir } = fresh();
  const turns = buildTurns(loadSources(dir, { sinceMs: 0 }));
  assert.deepEqual(recentTurns(turns, { n: 2 }).map((t) => t.message), ["no amazon is a website", "remind me to call mum"]);
  assert.deepEqual(recentTurns(turns, { n: 2, exclude: "Remind me to call mum" }).map((t) => t.message), ["open amazon uk", "no amazon is a website"]);
});

test("missing sources give no turns instead of an error", () => {
  const dir = mkdtempSync(join(tmpdir(), "selfcheck-empty-"));
  assert.deepEqual(buildTurns(loadSources(dir, { sinceMs: 0 })), []);
});
