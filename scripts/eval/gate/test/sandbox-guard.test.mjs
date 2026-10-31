// REV4 items 5, 6, 7: the sandbox seam must not leak into Nick's real use.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { holdMarker } from "../lib/marker.mjs";
import { paths } from "../lib/live.mjs";
import { SANDBOX_FILES } from "../lib/setup.mjs";
import { restoreState, snapshotState, verifyRestore, effectSince } from "../lib/state.mjs";
import { cleanSandbox, leftoverSandboxFiles, recentInbound } from "../lib/sandbox-guard.mjs";
import { runScenarios } from "../run.mjs";

function home() {
  const h = mkdtempSync(join(tmpdir(), "gate-guard-"));
  const ctrl = join(h, ".openclaw/orion-controlled");
  mkdirSync(ctrl, { recursive: true }); mkdirSync(join(h, ".openclaw/workspace/memory"), { recursive: true });
  return { ctrl, p: paths(h) };
}
const age = (f, ms) => { const t = new Date(Date.now() - ms); utimesSync(f, t, t); };
const scenario = { id: "a1", area: "x", wording: "clear", pair: "p", writes: false, setup: {}, turns: [{ text: "hi" }], expect: { rubric: "r", reply_must: ["x"], reply_must_not: ["y"] } };
const opts = (ctrl) => ({ outDir: join(ctrl, "out"), evalMode: "off", inbound: "off", allowedApps: [], handleSignals: false });

test("runScenarios refuses to start beside a sandbox file of ANY age, with a recovery hint", async () => {
  const { ctrl, p } = home();
  const f = join(ctrl, "eval-calendar.json"); writeFileSync(f, "{}"); age(f, 5 * 3600_000);
  assert.deepEqual(leftoverSandboxFiles(p), [f]);
  await assert.rejects(runScenarios({ scenarios: [scenario], opts: opts(ctrl), p, log: () => {} }), /--clean-sandbox/);
  // a dry run writes nothing and stays allowed
  await runScenarios({ scenarios: [scenario], opts: { ...opts(ctrl), dryRun: true }, p, log: () => {} });
});

test("cleanSandbox removes every sandbox file and nothing else", () => {
  const { ctrl, p } = home();
  for (const n of SANDBOX_FILES) writeFileSync(join(ctrl, n), "x");
  writeFileSync(join(ctrl, "reminders.json"), "keep");
  const removed = cleanSandbox(p);
  assert.equal(removed.length, SANDBOX_FILES.length);
  assert.deepEqual(leftoverSandboxFiles(p), []);
  assert.equal(readFileSync(join(ctrl, "reminders.json"), "utf8"), "keep");
});

test("holdMarker refuses a leftover sandbox calendar even with no live marker", () => {
  const { ctrl } = home();
  const sandboxCalendar = join(ctrl, "eval-calendar.json"); writeFileSync(sandboxCalendar, "{}");
  assert.throws(() => holdMarker({ marker: join(ctrl, "eval-mode"), sandboxCalendar, signals: false }), /sandbox/);
});

test("outreach.jsonl restore removes only the seeded ids and reports every other change", async () => {
  const { ctrl, p } = home();
  const row = (id, text) => `${JSON.stringify({ id, at: "2026-11-02T10:00:00Z", text })}\n`;
  const real = row("reach-1-aaaaaa", "real earlier");
  writeFileSync(join(ctrl, "outreach.jsonl"), real);
  const snap = await snapshotState(p);
  writeFileSync(join(ctrl, "outreach.jsonl"), real + row("reach-2-bbbbbb", "seeded"));
  const base = await snapshotState(p);
  // the live system writes a real row meanwhile, AFTER the seeded one
  writeFileSync(join(ctrl, "outreach.jsonl"), real + row("reach-2-bbbbbb", "seeded") + row("reach-3-cccccc", "live push"));
  const effect = await effectSince(p, base);
  const actions = await restoreState(p, snap, effect, { seededOutreachIds: ["reach-2-bbbbbb"] });
  const after = readFileSync(join(ctrl, "outreach.jsonl"), "utf8");
  assert.equal(after, real + row("reach-3-cccccc", "live push"));
  assert.ok(actions.some((a) => /outreach\.jsonl/.test(a) && /1 other row/.test(a) && /not rewound/.test(a)), actions.join("|"));
  assert.equal((await verifyRestore(p, snap, { seededOutreachIds: ["reach-2-bbbbbb"] })).ok, true);
  // a seeded row that survives is a problem
  writeFileSync(join(ctrl, "outreach.jsonl"), after + row("reach-2-bbbbbb", "seeded"));
  assert.equal((await verifyRestore(p, snap, { seededOutreachIds: ["reach-2-bbbbbb"] })).ok, false);
});

test("pre-flight: a non-gate inbound turn in the last 10 min is reported", () => {
  const { ctrl, p } = home();
  const now = Date.parse("2026-11-02T10:00:00Z");
  assert.equal(recentInbound(p, { now }), null);
  const at = (min) => `${JSON.stringify({ at: new Date(now - min * 60_000).toISOString() })}\n`;
  writeFileSync(join(ctrl, "inbound-turns.jsonl"), at(45) + at(12));
  assert.equal(recentInbound(p, { now }), null);
  writeFileSync(join(ctrl, "inbound-turns.jsonl"), at(45) + at(4) + "garbage\n");
  assert.equal(recentInbound(p, { now }).minutesAgo, 4);
});

test("runScenarios logs the inbound warning but still runs", async () => {
  const { ctrl, p } = home();
  writeFileSync(join(ctrl, "inbound-turns.jsonl"), `${JSON.stringify({ at: new Date().toISOString() })}\n`);
  const lines = [];
  await runScenarios({ scenarios: [], opts: opts(ctrl), p, log: (s) => lines.push(s) });
  assert.ok(lines.some((l) => /WARNING.*inbound/i.test(l)), lines.join("|"));
  assert.equal(existsSync(join(ctrl, "out/summary.json")), true);
});
