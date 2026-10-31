import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { messageText, seedOutreach, REAL_ID, ageFromNotes } from "../lib/seed-outreach.mjs";
import { parseOutreach, outreachPrefix } from "../lib/outreach.mjs";
import { applyPlan } from "../lib/setup.mjs";
import { restoreState, snapshotState, effectSince, verifyRestore } from "../lib/state.mjs";
import { dryRun } from "../lib/dry-run.mjs";

const NOW = Date.parse("2026-11-02T12:47:00Z");
const item = (turns, setup = {}) => ({ id: "x", setup, turns });
const sandboxPlan = { sandbox: { now: "2026-11-02T12:47:00Z" }, appends: [], applied: [] };
const livePlan = { sandbox: null, appends: [], applied: [] };

test("messageText strips the speaker prefix and quotes", () => {
  assert.equal(messageText('ORION: "Leave in 13 min."'), "Leave in 13 min.");
  assert.equal(messageText('ORION morning brief: "Top of your list."'), "Top of your list.");
});

test("seeds one row per distinct text, gives the turn that row's id, records applied", () => {
  const t = 'ORION: "Leave now."';
  const { plan, rows, replyTo } = seedOutreach(item([{ text: "a", replyToOutreach: t }, { text: "b", replyToOutreach: t }, { text: "c", replyToOutreach: null }]), sandboxPlan, NOW);
  assert.equal(rows.length, 1);
  assert.match(rows[0].id, REAL_ID);
  assert.equal(replyTo(t), rows[0].id);
  assert.equal(replyTo(null), null);
  assert.deepEqual(plan.applied, [`outreach:${rows[0].id}`]);
  assert.equal(sandboxPlan.applied.length, 0, "input plan untouched");
});

test("a real id is left alone", () => {
  const id = "reach-1793479842681-8cf5ac";
  const { rows, replyTo } = seedOutreach(item([{ text: "a", replyToOutreach: id }]), sandboxPlan, NOW);
  assert.equal(rows.length, 0);
  assert.equal(replyTo(id), id);
});

test("`at`: sandbox uses notes clock time and sandbox now; live uses real now and ignores clock times", () => {
  const t = [{ text: "a", replyToOutreach: 'ORION: "Leave now."' }];
  const sb = seedOutreach(item(t, { notes: 'Nick got "x" at 12:42.' }), sandboxPlan, NOW).rows[0];
  assert.equal(sb.at, "2026-11-02T12:42:00.000Z");
  const dflt = seedOutreach(item(t), sandboxPlan, NOW).rows[0];
  assert.equal(Date.parse(dflt.at), NOW - 5 * 60_000);
  const realNow = Date.parse("2026-11-05T09:00:00Z");
  const live = seedOutreach(item(t, { notes: 'got it at 12:42.' }), livePlan, realNow).rows[0];
  assert.equal(Date.parse(live.at), realNow - 5 * 60_000);
  const ago = seedOutreach(item(t, { notes: "asked 20 min ago." }), livePlan, realNow).rows[0];
  assert.equal(Date.parse(ago.at), realNow - 20 * 60_000);
  assert.equal(ageFromNotes("at 23:50", Date.parse("2026-11-03T00:10:00Z"), { sandbox: true }), 20);
});

test("the prefix now carries the message; the old text-as-id sent none", () => {
  const t = 'ORION: "Leave in 13 min for MKTG2201 at 1:30 PM."';
  const { plan, replyTo } = seedOutreach(item([{ text: "ok", replyToOutreach: t }]), sandboxPlan, NOW);
  const rows = parseOutreach(plan.appends[0].text);
  const { prefix } = outreachPrefix({ rows, now: NOW, replyTo: replyTo(t) });
  assert.match(prefix, /you messaged him first, 5 min ago: "Leave in 13 min for MKTG2201 at 1:30 PM\."/);
  assert.equal(outreachPrefix({ rows: [], now: NOW, replyTo: t }).prefix, "");
});

function fakeP() {
  const home = mkdtempSync(join(tmpdir(), "seed-test-"));
  const ctrl = join(home, "ctrl"), workspace = join(home, "ws");
  mkdirSync(join(workspace, "memory"), { recursive: true }); mkdirSync(ctrl, { recursive: true });
  return { ctrl, workspace, scripts: join(home, "scripts"), undo: join(ctrl, "reschedule-undo.json"), sandboxCalendar: join(ctrl, "eval-calendar.json"),
    outreach: join(ctrl, "outreach.jsonl"), node: process.execPath, orionSession: join(home, "none") };
}

test("applyPlan appends (after a missing newline) and restore removes the seeded row by id, verified", async () => {
  const p = fakeP();
  const old = '{"id":"o1","text":"hi","at":"2026-11-01T00:00:00Z"}';   // no trailing newline
  writeFileSync(p.outreach, old);
  const snap = await snapshotState(p);
  const { plan, rows } = seedOutreach(item([{ text: "a", replyToOutreach: 'ORION: "Leave now."' }]), sandboxPlan, NOW);
  const seededOutreachIds = rows.map((r) => r.id);
  applyPlan(p, { writes: [], appends: plan.appends, sandbox: null });
  const lines = readFileSync(p.outreach, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[1]).text, "Leave now.");
  const effect = await effectSince(p, snap);
  const actions = await restoreState(p, snap, effect, { seededOutreachIds });
  assert.ok(actions.includes("removed 1 seeded row(s) from outreach.jsonl"), actions.join("|"));
  assert.equal(readFileSync(p.outreach, "utf8").trim(), old);
  assert.equal((await verifyRestore(p, snap, { seededOutreachIds })).ok, true);
});

test("restore never rewinds an outreach.jsonl that something else rewrote: it reports", async () => {
  const p = fakeP();
  writeFileSync(p.outreach, "AAA\n");
  const snap = await snapshotState(p);
  writeFileSync(p.outreach, "BBB\n");
  const actions = await restoreState(p, snap, await effectSince(p, snap));
  assert.ok(actions.some((a) => a.startsWith("REPORTED outreach.jsonl") && /not rewound/.test(a)));
  assert.equal(readFileSync(p.outreach, "utf8"), "BBB\n");
});

test("dry run reports the seeded outreach per item", async () => {
  const p = fakeP();
  const items = [item([{ text: "a", replyToOutreach: 'ORION: "Leave now."' }], { now: "2026-11-02T12:47:00Z", live: true }), item([{ text: "b" }])];
  const { rows, summary } = await dryRun({ items, p, realNow: NOW });
  assert.equal(rows[0].outreach.length, 1);
  assert.match(rows[0].applied.join(";"), /outreach:reach-/);
  assert.equal(rows[1].outreach.length, 0);
  assert.equal(summary.itemsWithOutreach, 1);
});
