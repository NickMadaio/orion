// The runner against a fake home: a fake `openclaw`, `orion-session` and `orion-reschedule`, a scratch
// controlled dir. Nothing here touches the real ORION or sends anything.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { holdMarker } from "../lib/marker.mjs";
import { validateScenarios, checkReplies, toRegex } from "../lib/scenarios.mjs";
import { lineDelta } from "../lib/state.mjs";
import { paths } from "../lib/live.mjs";
import { runScenarios, recover } from "../run.mjs";
import { sessionKeyFor } from "../ask.mjs";

const NODE = process.execPath;

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), "gate-test-"));
  const ctrl = join(home, ".openclaw/orion-controlled");
  const scripts = join(home, "scripts");
  for (const d of [join(home, ".openclaw/bin"), join(home, ".openclaw/tools/node-v24.15.0/bin"), join(ctrl, "local-routing"), join(home, ".openclaw/workspace/memory"), join(scripts, "lib/life")]) mkdirSync(d, { recursive: true });
  symlinkSync(NODE, join(home, ".openclaw/tools/node-v24.15.0/bin/node"));
  const exe = (file, body) => { writeFileSync(file, `#!${NODE}\n${body}`); chmodSync(file, 0o755); };
  // Fake gateway CLI: replies, records whether the marker was held, and "moves gym" writes state + a journal entry.
  exe(join(home, ".openclaw/bin/openclaw"), `
const fs = require("fs"); const a = process.argv.slice(2); const msg = a[a.indexOf("--message") + 1];
const ctrl = ${JSON.stringify(ctrl)};
fs.appendFileSync(ctrl + "/seen.log", JSON.stringify({ marker: fs.existsSync(ctrl + "/eval-mode"), key: a[a.indexOf("--session-key") + 1], thinking: a[a.indexOf("--thinking") + 1], msg }) + "\\n");
if (/move gym/.test(msg)) {
  fs.writeFileSync(ctrl + "/reminders.json", '{"gym":"6pm"}');
  const j = JSON.parse(fs.readFileSync(ctrl + "/reschedule-undo.json", "utf8")); j.push({ at: "now", steps: [1] });
  fs.writeFileSync(ctrl + "/reschedule-undo.json", JSON.stringify(j));
}
console.log(JSON.stringify({ runId: "r1", status: "ok", result: { payloads: [{ text: /move gym/.test(msg) ? "Moved gym to 6 PM." : "You have nothing today." }], meta: { agentMeta: { model: "fake" } } } }));
`);
  exe(join(scripts, "orion-session"), `console.log(JSON.stringify({ status: "finished", enforcement: "off" }));`);
  exe(join(scripts, "orion-reschedule"), `
const fs = require("fs"); const f = ${JSON.stringify(join(ctrl, "reschedule-undo.json"))};
const j = JSON.parse(fs.readFileSync(f, "utf8")); j.pop(); fs.writeFileSync(f, JSON.stringify(j)); console.log("Undone: last change");
`);
  writeFileSync(join(scripts, "lib/life/bridge-path.mjs"), `export async function bridgeRequest() { throw new Error("no bridge in tests"); }`);
  writeFileSync(join(ctrl, "reschedule-undo.json"), JSON.stringify([{ at: "earlier", steps: [1] }]));
  writeFileSync(join(home, ".openclaw/workspace/SCHEDULING.md"), "# none\n");
  writeFileSync(join(ctrl, "outreach.jsonl"), "");
  process.env.ORION_SCRIPTS = scripts;
  return { home, ctrl, p: paths(home) };
}

const item = (over) => ({ id: "a1", area: "calendar", wording: "clear", pair: "p", writes: false, setup: {}, turns: [{ text: "whats on today" }],
  expect: { rubric: "says nothing today", reply_must: ["nothing"], reply_must_not: ["error"] }, ...over });

test("a write item: effect recorded before undo, then undone and verified; read-only mode skips it", async () => {
  const { ctrl, p } = fakeHome();
  const outDir = join(ctrl, "out");
  const scenarios = [item({}), item({ id: "w1", writes: true, wording: "vague", turns: [{ text: "move gym to 6" }], expect: { rubric: "moved", reply_must: ["6 PM"] } })];
  const { results, summary } = await runScenarios({ scenarios, opts: { outDir, evalMode: "on", inbound: "off", allowedApps: [], handleSignals: false, stamp: "0101" }, p, log: () => {} });
  const w = results.find((r) => r.id === "w1");
  assert.equal(w.effect.files[0].kind, "created");
  assert.match(w.effect.files[0].path, /reminders\.json$/);
  assert.equal(w.effect.calendar.newEntries.length, 1);
  assert.ok(w.cleanup.actions.includes("calendar undo: Undone: last change"));
  assert.ok(w.cleanup.actions.includes("undo journal restored"));
  assert.equal(w.cleanup.verified.ok, true, JSON.stringify(w.cleanup.verified));
  assert.equal(existsSync(join(ctrl, "reminders.json")), false, "state file put back");
  assert.deepEqual(JSON.parse(readFileSync(join(ctrl, "reschedule-undo.json"), "utf8")), [{ at: "earlier", steps: [1] }]);
  assert.equal(summary.regex.pass, 2);
  assert.deepEqual(summary.changedState, ["w1"]);
  const seen = readFileSync(join(ctrl, "seen.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.ok(seen.every((s) => s.marker === true), "marker held for every turn");
  assert.ok(seen.every((s) => /^orion-chat-gate-0101-\d+$/.test(s.key) && !/eval|test/i.test(s.key)), "session keys never contain eval or test");
  assert.equal(existsSync(join(ctrl, "eval-mode")), false, "marker removed afterwards");
  assert.equal(existsSync(join(outDir, "inflight-snapshot.json")), false);

  const ro = await runScenarios({ scenarios, opts: { outDir: join(ctrl, "out2"), evalMode: "off", readonly: true, inbound: "off", allowedApps: [], handleSignals: false }, p, log: () => {} });
  assert.equal(ro.summary.skipped, 1);
  assert.equal(ro.results.find((r) => r.id === "w1").skipped, "readonly mode");
});

test("multi-turn items share one conversation key, and the app context rides on every turn", async () => {
  const { ctrl, p } = fakeHome();
  const s = [item({ id: "m1", turns: [{ text: "hi" }, { text: "and tomorrow?", spoken: true }] })];
  const { results } = await runScenarios({ scenarios: s, opts: { outDir: join(ctrl, "o"), evalMode: "off", inbound: "off", allowedApps: [], handleSignals: false, stamp: "0202" }, p, log: () => {} });
  const seen = readFileSync(join(ctrl, "seen.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));
  assert.equal(seen[0].key, seen[1].key);
  assert.match(seen[0].msg, /^\[Orion app context — factual state supplied by the native app\]\nFocus session: inactive\./);
  assert.ok(!seen[0].msg.includes("SAID this out loud") && seen[1].msg.includes("SAID this out loud"));
  assert.equal(results[0].turns.length, 2);
});

test("recover restores from an interrupted run's in-flight snapshot", async () => {
  const { ctrl, p } = fakeHome();
  const { snapshotState } = await import("../lib/state.mjs");
  const outDir = join(ctrl, "crashed"); mkdirSync(outDir);
  writeFileSync(join(outDir, "inflight-snapshot.json"), JSON.stringify({ id: "x", snap: await snapshotState(p) }));
  writeFileSync(join(ctrl, "reminders.json"), "{\"half\":\"done\"}");
  const r = await recover(outDir, p);
  assert.equal(r.recovered, true);
  assert.equal(existsSync(join(ctrl, "reminders.json")), false);
  assert.equal((await recover(outDir, p)).recovered, false);
});

test("marker: backdated so a crash self-expires, refuses a live one, refuses a sandbox calendar, expires at max age", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gate-marker-"));
  const marker = join(dir, "eval-mode"), sandboxCalendar = join(dir, "eval-calendar.json");
  const h = holdMarker({ marker, sandboxCalendar, signals: false, heartbeatMs: 20, maxAgeMs: 10_000 });
  const age = Date.now() - statSync(marker).mtimeMs;
  assert.ok(age > 100 * 60_000 && age < 110 * 60_000, `backdated ~105 min, was ${age / 60000}`);
  assert.throws(() => holdMarker({ marker, sandboxCalendar, signals: false }), /already live/);
  h.release();
  assert.equal(existsSync(marker), false);
  h.release();   // idempotent

  writeFileSync(sandboxCalendar, "{}");
  const live = (() => { writeFileSync(marker, "someone else"); return true; })();
  assert.ok(live);
  assert.throws(() => holdMarker({ marker, sandboxCalendar, signals: false }), /sandbox/);
  rmSync(marker); rmSync(sandboxCalendar);

  let expired = false;
  const e = holdMarker({ marker, sandboxCalendar, signals: false, heartbeatMs: 10, maxAgeMs: 30, onExpire: () => { expired = true; } });
  await new Promise((r) => setTimeout(r, 120));
  assert.equal(expired, true);
  assert.equal(existsSync(marker), false, "removed at max age");
  assert.equal(e.expired(), true);
});

test("marker: removed on SIGTERM and on SIGINT (real process)", async () => {
  const { spawn } = await import("node:child_process");
  for (const sig of ["SIGTERM", "SIGINT"]) {
    const dir = mkdtempSync(join(tmpdir(), "gate-sig-"));
    const marker = join(dir, "eval-mode");
    const code = `import { holdMarker } from ${JSON.stringify(new URL("../lib/marker.mjs", import.meta.url).href)};
      holdMarker({ marker: ${JSON.stringify(marker)}, sandboxCalendar: ${JSON.stringify(join(dir, "c.json"))} }); console.log("held"); setInterval(() => {}, 1000);`;
    const child = spawn(NODE, ["--input-type=module", "-e", code], { stdio: ["ignore", "pipe", "inherit"] });
    await new Promise((r) => child.stdout.once("data", r));
    assert.equal(existsSync(marker), true);
    child.kill(sig);
    await new Promise((r) => child.once("close", r));
    assert.equal(existsSync(marker), false, `${sig} removes the marker`);
  }
});

test("scenario validation, regex forms and reply checks", () => {
  assert.deepEqual(validateScenarios([item({})]), []);
  const errs = validateScenarios([item({ id: "bad id" }), item({ id: "b", wording: "meh" }), item({ id: "c", turns: [] }), item({ id: "d", writes: undefined }), item({ id: "e", expect: { rubric: "x", reply_must: ["("] } })]);
  assert.equal(errs.length, 5, errs.join("\n"));
  assert.equal(validateScenarios([item({}), item({})]).length, 1, "duplicate id");
  assert.ok(toRegex("/Hello/").test("Hello") && !toRegex("/Hello/").test("hello"));
  assert.ok(toRegex("hello").test("HELLO"));
  const c = checkReplies({ rubric: "r", reply_must: ["6 pm"], reply_must_not: ["sorry"] }, ["sorry about that", "Moved to 6 PM"]);
  assert.equal(c.reply_must[0].pass, true);
  assert.equal(c.reply_must_not[0].pass, false);
  assert.equal(c.passed, false);
});

test("session keys: gate keys pass, eval/test words are refused", () => {
  assert.equal(sessionKeyFor("gate-1030-1"), "orion-chat-gate-1030-1");
  assert.throws(() => sessionKeyFor("my-test-chat"), /internal/);
  assert.throws(() => sessionKeyFor("evaluation-1"), /internal/);
});

test("lineDelta reports added and removed lines", () => {
  const d = lineDelta("a\nb\nc", "a\nc\nd");
  assert.deepEqual(d, { added: ["d"], removed: ["b"] });
});
