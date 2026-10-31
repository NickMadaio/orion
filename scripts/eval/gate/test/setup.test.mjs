// Item setup: the sandbox calendar + clock, the health fixtures, the live tier's tokens, the dry run, and crash
// recovery. A fake home and a fake gateway CLI; nothing here touches the real ORION.
import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { paths } from "../lib/live.mjs";
import { runScenarios, recover } from "../run.mjs";
import { askTurn } from "../ask.mjs";
import { quickAnswer } from "../prefix.mjs";
import { initialTracker } from "../lib/outreach.mjs";
import { snapshotState, trackedFiles } from "../lib/state.mjs";
import { applyPlan, planSetup, renderTokens, sandboxDay, spokenClock, timezoneMet, SANDBOX_FILES } from "../lib/setup.mjs";
import { validateScenarios } from "../lib/scenarios.mjs";
import { calendarFor, withSetup } from "../tools/gen-setup.mjs";

const NODE = process.execPath;
const NOW = "2026-11-02T16:30:00Z";

function fakeHome() {
  const home = mkdtempSync(join(tmpdir(), "gate-setup-"));
  const ctrl = join(home, ".openclaw/orion-controlled");
  const scripts = join(home, "scripts");
  for (const d of [join(home, ".openclaw/bin"), join(home, ".openclaw/tools/node-v24.15.0/bin"), join(ctrl, "local-routing"), join(home, ".openclaw/workspace/memory"), join(scripts, "lib/life")]) mkdirSync(d, { recursive: true });
  symlinkSync(NODE, join(home, ".openclaw/tools/node-v24.15.0/bin/node"));
  const exe = (file, body) => { writeFileSync(file, `#!${NODE}\n${body}`); chmodSync(file, 0o755); };
  // The fake gateway records what the live system would see during the turn, and "moves gym" inside the sandbox.
  exe(join(home, ".openclaw/bin/openclaw"), `
const fs = require("fs"); const a = process.argv.slice(2); const msg = a[a.indexOf("--message") + 1];
const ctrl = ${JSON.stringify(ctrl)}; const cal = ctrl + "/eval-calendar.json";
const read = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const day = read(cal);
fs.appendFileSync(ctrl + "/seen.log", JSON.stringify({ msg, sandboxNow: day?.now ?? null, events: day?.events?.length ?? 0, lifeCopy: fs.existsSync(ctrl + "/eval-life-config.json"),
  health: read(ctrl + "/health-log.json"), logged: fs.existsSync(ctrl + "/logged.jsonl") ? fs.readFileSync(ctrl + "/logged.jsonl", "utf8") : "" }) + "\\n");
if (/move gym/.test(msg) && day) {
  const events = day.events.map((e) => e.title === "Gym" && e.start.startsWith("2026-11-02") ? { ...e, start: "2026-11-02T19:00:00Z", end: "2026-11-02T20:30:00Z" } : e);
  fs.writeFileSync(cal, JSON.stringify({ ...day, events }));
}
console.log(JSON.stringify({ runId: "r1", status: "ok", result: { payloads: [{ text: "Moved gym to 7 PM." }], meta: { agentMeta: { model: "fake" } } } }));
`);
  exe(join(scripts, "orion-session"), `console.log(JSON.stringify({ status: "finished", enforcement: "off" }));`);
  exe(join(scripts, "orion-reschedule"), `console.log("Undone: nothing");`);
  writeFileSync(join(scripts, "lib/life/bridge-path.mjs"), `export async function bridgeRequest() { throw new Error("no bridge in tests"); }`);
  writeFileSync(join(ctrl, "reschedule-undo.json"), "[]");
  writeFileSync(join(ctrl, "life-config.json"), JSON.stringify({ ranks: { gym: "must" } }));
  writeFileSync(join(ctrl, "health-log.json"), JSON.stringify({ schema: "orion.health.v3", supplements: [], supplementLog: {}, workouts: [], days: { "2026-10-31": { sleepHours: 7.5, recovery: 60 } } }));
  writeFileSync(join(ctrl, "logged.jsonl"), "");
  writeFileSync(join(home, ".openclaw/workspace/SCHEDULING.md"), "# none\n");
  writeFileSync(join(ctrl, "outreach.jsonl"), "");
  process.env.ORION_SCRIPTS = scripts;
  return { home, ctrl, p: paths(home) };
}

const calendar = { now: NOW, events: [
  { title: "MKTG2201", start: "2026-11-02T13:30:00Z", end: "2026-11-02T15:30:00Z" },
  { title: "Gym", start: "2026-11-02T17:00:00Z", end: "2026-11-02T18:30:00Z", owned: "gym" }], reminders: [{ title: "finish resume" }] };
const item = (over = {}) => ({ id: "s1", area: "schedule", wording: "clear", pair: "p", writes: true, setup: { now: NOW, calendar }, turns: [{ text: "move gym to 7" }],
  expect: { rubric: "moved" }, ...over });
const opts = (ctrl, over = {}) => ({ outDir: join(ctrl, `out-${Math.random().toString(36).slice(2)}`), evalMode: "on", inbound: "off", allowedApps: [], handleSignals: false, stamp: "0101", ...over });
const seen = (ctrl) => readFileSync(join(ctrl, "seen.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l));

test("a sandboxed item: the turn sees the sandbox day and clock, the move is recorded, then every sandbox file is gone", async () => {
  const { ctrl, p } = fakeHome();
  const { results } = await runScenarios({ scenarios: [item()], opts: opts(ctrl), p, log: () => {} });
  const r = results[0], s = seen(ctrl)[0];
  assert.equal(s.sandboxNow, NOW, "the live system saw the sandbox's now");
  assert.equal(s.events, 2);
  assert.equal(s.lifeCopy, true, "eval-life-config.json copied for the sandbox planner");
  assert.deepEqual(r.effect.sandboxCalendar.moved, [{ title: "Gym", from: ["2026-11-02T17:00:00Z", "2026-11-02T18:30:00Z"], to: ["2026-11-02T19:00:00Z", "2026-11-02T20:30:00Z"] }]);
  assert.equal(r.effect.changedAnything, true);
  assert.deepEqual(r.effect.calendar.newEntries, [], "his real undo journal untouched");
  for (const f of SANDBOX_FILES) assert.equal(existsSync(join(ctrl, f)), false, `${f} removed`);
  assert.ok(r.cleanup.actions.includes("removed sandbox eval-calendar.json"));
  assert.equal(r.cleanup.verified.ok, true, JSON.stringify(r.cleanup.verified));
  assert.ok(r.setup.applied.some((a) => a.startsWith("calendar (sandbox: 2 events, 1 to-dos)")));
  assert.ok(r.setup.applied.includes(`now:${NOW}`));
  assert.deepEqual(r.setup.unmet, []);
  assert.equal(r.effect.otherChanged.filter((f) => f.startsWith("eval-")).length, 0, "sandbox files are never reported as other changes");
});

test("health fixtures land in the files ORION reads during the turn and are restored after", async () => {
  const { ctrl, p } = fakeHome();
  const before = readFileSync(join(ctrl, "health-log.json"), "utf8");
  const it = item({ id: "h1", writes: false, turns: [{ text: "how did i sleep" }],
    setup: { now: "2026-11-03T08:00:00Z", calendar: { ...calendar, now: "2026-11-03T08:00:00Z" }, state: { sleep_last_night_h: 4.5, whoop_recovery: 31, gym_done_days_last7: 4, llm: "down" } } });
  const { results } = await runScenarios({ scenarios: [it], opts: opts(ctrl), p, log: () => {} });
  const s = seen(ctrl)[0];
  assert.equal(s.health.days["2026-11-03"].sleepHours, 4.5);
  assert.equal(s.health.days["2026-11-03"].recovery, 31);
  assert.equal(s.health.days["2026-10-31"].sleepHours, 7.5, "his real days are kept");
  assert.deepEqual(s.health.workouts.map((w) => w.day), ["2026-11-02", "2026-11-01", "2026-10-30", "2026-10-28"]);
  assert.equal(s.logged.trim().split("\n").length, 4, "four gym days in logged.jsonl (what habitAnswer counts)");
  assert.equal(readFileSync(join(ctrl, "health-log.json"), "utf8"), before, "health log put back byte for byte");
  assert.equal(readFileSync(join(ctrl, "logged.jsonl"), "utf8"), "", "logged.jsonl truncated back");
  const r = results[0];
  assert.deepEqual(r.effect.files, [], "the fixture is not counted as the item's effect");
  assert.ok(r.setup.unmet.some((u) => u.startsWith("llm:down")));
  assert.equal(r.cleanup.verified.ok, true, JSON.stringify(r.cleanup.verified));
});

test("crash mid-item: recover removes the sandbox and the fixtures", async () => {
  const { ctrl, p } = fakeHome();
  const outDir = join(ctrl, "crashed"); mkdirSync(outDir);
  const before = readFileSync(join(ctrl, "health-log.json"), "utf8");
  writeFileSync(join(outDir, "inflight-snapshot.json"), JSON.stringify({ id: "x", snap: await snapshotState(p) }));
  const writable = new Map(trackedFiles(p).map((f) => [basename(f), f]));
  applyPlan(p, await planSetup(p, { calendar, state: { sleep_last_night_h: 5 } }, { writable }));
  writeFileSync(join(ctrl, "eval-reschedule-undo.json"), "[{}]");   // a sandbox write happened before the crash
  assert.equal(existsSync(p.sandboxCalendar), true);
  const r = await recover(outDir, p);
  assert.equal(r.recovered, true, JSON.stringify(r));
  for (const f of SANDBOX_FILES) assert.equal(existsSync(join(ctrl, f)), false, `${f} removed by recover`);
  assert.equal(readFileSync(join(ctrl, "health-log.json"), "utf8"), before);
});

test("a sandbox file that is not this item's stops the item; eval-mode off skips sandboxed items", async () => {
  const { ctrl, p } = fakeHome();
  writeFileSync(p.sandboxCalendar, JSON.stringify({ now: "2026-01-01T00:00:00Z", events: [] }));
  const { results } = await runScenarios({ scenarios: [item({ id: "real1", setup: {}, turns: [{ text: "hi" }] })], opts: opts(ctrl, { evalMode: "off" }), p, log: () => {} });
  assert.match(results[0].turns[0].error, /sandbox file\(s\) already present/);
  assert.equal(existsSync(join(ctrl, "seen.log")), false, "nothing sent");
  assert.equal(existsSync(p.sandboxCalendar), true, "someone else's sandbox left alone");

  const { ctrl: c2, p: p2 } = fakeHome();
  const off = await runScenarios({ scenarios: [item()], opts: opts(c2, { evalMode: "off" }), p: p2, log: () => {} });
  assert.equal(off.results[0].skipped, "sandboxed item needs --eval-mode on");
});

test("--tier picks live or sandbox items; live turns render their tokens against the real clock", async () => {
  const { ctrl, p } = fakeHome();
  const live = item({ id: "l1", setup: { live: true }, turns: [{ text: "add cs lab {{now+5m}} to {{now+195m}} tonight" }] });
  const { results } = await runScenarios({ scenarios: [item(), live], opts: opts(ctrl, { tier: "live" }), p, log: () => {} });
  assert.deepEqual(results.map((r) => r.id), ["l1"]);
  assert.match(results[0].turns[0].text, /^add cs lab \d{1,2}(:\d{2})?[ap]m to \d{1,2}(:\d{2})?[ap]m tonight$/);
  assert.equal(results[0].turns[0].template, live.turns[0].text);
  assert.equal(seen(ctrl)[0].sandboxNow, null, "a live item never sees a sandbox");
  const sb = await runScenarios({ scenarios: [item(), live], opts: opts(ctrl, { tier: "sandbox" }), p, log: () => {} });
  assert.deepEqual(sb.results.map((r) => r.id), ["s1"]);
});

test("dry run: every item's plan and per-key counts, with nothing written or sent", async () => {
  const { ctrl, p } = fakeHome();
  const health = readFileSync(join(ctrl, "health-log.json"), "utf8");
  const scenarios = [item(), item({ id: "h", setup: { now: NOW, calendar, state: { timezone: "Europe/London", llm: "down", whoop_recovery: 40 } } }),
    item({ id: "l", setup: { live: true }, turns: [{ text: "move gym to {{now+150m}} today" }] }), item({ id: "n", setup: { notes: "memory" } })];
  const { rows, summary } = await runScenarios({ scenarios, opts: { dryRun: true, hostZone: "Europe/London" }, p, log: () => {} });
  assert.equal(rows.length, 4);
  assert.equal(summary.sandboxed, 2); assert.equal(summary.live, 1); assert.equal(summary.realTimeNoFixture, 1);
  assert.equal(summary.appliedByKey.calendar, 2);
  assert.equal(summary.appliedByKey.whoop_recovery, 1);
  assert.equal(summary.unmetByKey.llm, 1);
  assert.match(rows[2].turns[0], /^move gym to \d/);
  assert.equal(existsSync(join(ctrl, "seen.log")), false, "no gateway call");
  assert.equal(existsSync(p.sandboxCalendar), false, "no sandbox written");
  assert.equal(readFileSync(join(ctrl, "health-log.json"), "utf8"), health);
});

test("prefix: a sandboxed turn's app-side clock is the sandbox's (QuickAnswer, outreach age); real time is unchanged", async () => {
  const { ctrl, p } = fakeHome();
  const sandboxMs = Date.parse(NOW);
  writeFileSync(join(ctrl, "outreach.jsonl"), `${JSON.stringify({ id: "o1", text: "Time to start: Gym.", at: new Date(sandboxMs - 5 * 60_000).toISOString() })}\n`);
  const q = await askTurn({ text: "what time is it", conversation: "gate-x-1" }, { tracker: initialTracker(), boosts: new Map(), clock: () => sandboxMs }, p);
  assert.equal(q.reply, quickAnswer("what time is it", new Date(sandboxMs)));
  assert.notEqual(q.reply, quickAnswer("what time is it", new Date(sandboxMs + 3 * 3600_000)), "the answer depends on the clock it was given");
  const d = await askTurn({ text: "ok", conversation: "gate-x-2", dryRun: true }, { tracker: initialTracker(), boosts: new Map(), clock: () => sandboxMs }, p);
  assert.match(d.message, /^\[ORION context: you messaged him first, 5 min ago: "Time to start: Gym\."/);
  // Real time: the same row is days old, so no outreach prefix, exactly as before.
  const r = await askTurn({ text: "ok", conversation: "gate-x-3", dryRun: true }, { tracker: initialTracker(), boosts: new Map() }, p);
  assert.match(r.message, /^\[Orion app context/);
});

test("tokens, spoken clock and the timezone check", () => {
  const at = new Date(2026, 10, 2, 19, 13).getTime();   // host-local 19:13
  assert.equal(renderTokens("at {{now}}", at), "at 7:15pm");
  assert.equal(renderTokens("{{now+45m}} / {{now-90m}} / {{now+2h}}", at), "8pm / 5:45pm / 9:15pm");
  assert.equal(renderTokens("{{today 17:00}} {{tomorrow 09:30}}", at), "5pm 9:30am");
  assert.equal(timezoneMet("Europe/London", Date.parse(NOW), "UTC"), true, "London is UTC in November");
  assert.equal(timezoneMet("Europe/London", Date.parse("2026-07-01T12:00:00Z"), "UTC"), false, "but not in July");
  assert.equal(timezoneMet("America/New_York", Date.parse(NOW), "Europe/London"), false);
  assert.deepEqual(sandboxDay(calendar).events[1], { identifier: "seed-1", title: "Gym", start: "2026-11-02T17:00:00Z", end: "2026-11-02T18:30:00Z", orion: "gym" });
});

test("validation: calendar shape, live exclusions and tokens", () => {
  assert.deepEqual(validateScenarios([item()]), []);
  const errs = (setup, turns) => validateScenarios([item({ setup, ...(turns ? { turns } : {}) })]);
  assert.match(errs({ now: NOW, calendar: { ...calendar, now: "2026-11-02T17:00:00Z" } }).join(), /disagree/);
  assert.match(errs({ calendar: { now: "monday", events: [] } }).join(), /ISO instant/);
  assert.match(errs({ calendar: { now: NOW, events: [{ title: "x", start: NOW, end: NOW }] } }).join(), /ends before/);
  assert.match(errs({ calendar: { now: NOW, events: [{ title: "x", start: NOW, end: "2026-11-02T18:00:00Z", owned: "party" }] } }).join(), /owned/);
  assert.match(errs({ live: true, calendar }).join(), /exclude/);
  assert.match(errs({ live: true, now: NOW }).join(), /real time/);
  assert.match(errs({}, [{ text: "at {{now+5m}}" }]).join(), /not setup.live/);
  assert.match(errs({ live: true }, [{ text: "at {{noon}}" }]).join(), /invalid token/);
  assert.deepEqual(errs({ live: true }, [{ text: "at {{now+5m}} and {{today 17:00}}" }]), []);
});

test("gen-setup is deterministic, the checked-in bank matches it, and the week fixture is the README's", () => {
  const script = fileURLToPath(new URL("../tools/gen-setup.mjs", import.meta.url));
  const r = spawnSync(NODE, [script, "--check"], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  const cal = calendarFor({ id: "sch-fixed-plan-protect-c", setup: { now: "2026-11-02T10:00:00Z" } });
  const today = cal.events.filter((e) => e.start.startsWith("2026-11-02")).map((e) => `${e.title} ${e.start.slice(11, 16)}-${e.end.slice(11, 16)}${e.owned ? "*" : ""}`);
  assert.deepEqual(today, ["MKTG2201 13:30-15:30", "Gym 17:00-18:30*", "dinner with Annika 19:00-21:00", "Side project 19:30-20:30*"]);
  assert.equal(cal.events.filter((e) => e.title === "Gym").length, 8, "gym every day, Monday to next Monday");
  const once = withSetup({ id: "sch-gym-moved-later-c", setup: { now: "2026-11-02T10:00:00Z", notes: "n" }, turns: [{ text: "move gym to 8:30pm today" }] });
  assert.deepEqual(withSetup(once), once, "idempotent");
  assert.equal(once.setup.live, true); assert.equal(once.setup.now, undefined);
  assert.equal(once.turns[0].text, "move gym to {{now+150m}} today");
});
