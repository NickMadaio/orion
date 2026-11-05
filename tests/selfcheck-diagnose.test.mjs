import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeFixtureDir } from "./selfcheck-fixture.mjs";
import { loadSources, buildTurns } from "../scripts/lib/selfcheck/turns.mjs";
import { diagnoseTurn, pickTurn, findFailures } from "../scripts/lib/selfcheck/diagnose.mjs";

const turns = () => { const dir = mkdtempSync(join(tmpdir(), "selfcheck-d-")); writeFixtureDir(dir); return buildTurns(loadSources(dir, { sinceMs: 0 })); };

test("an app that does not exist is a routing mistake, said in first person", () => {
  const t = turns().find((x) => x.message === "open amazon uk");
  const d = diagnoseTurn(t);
  assert.equal(d.kind, "wrong-tool");
  assert.equal(d.fixable, true);
  assert.match(d.says, /^I treated "amazon uk" as an app name/);
  assert.match(d.says, /routing mistake on my side/);
  assert.equal(d.signature, "wrong-tool:app_open");
  assert.ok(d.files.some((f) => f.endsWith("open-request.ts")));
});

test("a turn that went fine is not blamed", () => {
  const d = diagnoseTurn(turns().find((x) => x.message === "whats on my plan"));
  assert.equal(d.kind, "none");
  assert.equal(d.fixable, false);
  assert.match(d.says, /can't see a clear fault/);
});

test("a permission failure is not offered as a bug fix", () => {
  const d = diagnoseTurn({ at: "x", message: "turn on the lights", reply: "I couldn't.", route: { move: "tool" }, tools: [{ action: "lights_set", args: "{}", status: "failed_permanent", error: "permission denied: not authorized" }] });
  assert.equal(d.kind, "blocked");
  assert.equal(d.fixable, false);
});

test("claiming success after a failed tool is named as such", () => {
  const d = diagnoseTurn({ at: "x", message: "open safari", reply: "Done: opened Safari.", route: { move: "tool" }, tools: [{ action: "app_open", args: "{}", status: "failed_permanent", error: "boom" }] });
  assert.equal(d.kind, "claimed-success");
  assert.match(d.says, /I told you/);
});

test("giving up without calling a tool is a gap", () => {
  const d = diagnoseTurn({ at: "x", message: "open safari", reply: "I didn't actually do that — nothing was started or changed.", route: { move: "ask" }, tools: [] });
  assert.equal(d.kind, "no-action");
  assert.equal(d.fixable, true);
});

test("pickTurn follows what he names, else the latest failure, else the latest turn", () => {
  const ts = turns();
  assert.equal(pickTurn(ts, { about: "why didnt you open amazon", n: 6 }).message, "open amazon uk");
  assert.equal(pickTurn(ts, { about: "that was wrong", n: 6, exclude: "that was wrong" }).message, "open amazon uk");
  assert.equal(pickTurn(ts.slice(0, 1), { about: "why did you do that", n: 6 }).message, "whats on my plan");
  assert.equal(pickTurn([], { about: "why" }), undefined);
});

test("a question about 'that reply' is the newest turn, never an older failure (live gate 2, #43)", () => {
  const ts = turns();
  const newest = ts.at(-1).message;
  assert.notEqual(newest, "open amazon uk");
  for (const about of ["why did you reply like that", "whyd you answer that way", "why did you say it like that", "why would you respond like that lol", "why did you word it like that"])
    assert.equal(pickTurn(ts, { about, n: 6, exclude: about }).message, newest, about);
  // a named subject still wins
  assert.equal(pickTurn(ts, { about: "why didnt you open amazon", n: 6 }).message, "open amazon uk");
});

test("findFailures lists tool errors and dropped turns, once each", () => {
  const now = Date.parse("2026-11-05T00:00:00Z");
  const f = findFailures(turns(), { now });
  const kinds = f.map((x) => `${x.kind}:${x.message}`);
  assert.ok(kinds.includes("wrong-tool:open amazon uk"));
  assert.ok(kinds.includes("dropped:remind me to call mum"));
  assert.equal(f.filter((x) => x.message === "whats on my plan").length, 0);
  assert.equal(new Set(kinds).size, kinds.length);
});

test("a correction right after a reply that looked fine marks that reply as corrected", () => {
  const ok = (message, reply) => ({ at: "2026-11-04T10:00:00.000Z", message, reply, route: { move: "answer" }, tools: [] });
  const f = findFailures([ok("whats the weather", "Its 12C and dry."), ok("no thats wrong its raining", "Sorry.")], { now: Date.parse("2026-11-04T10:00:30Z") });
  assert.deepEqual(f.map((x) => x.kind), ["corrected"]);
  assert.match(f[0].says, /You corrected me/);
});
