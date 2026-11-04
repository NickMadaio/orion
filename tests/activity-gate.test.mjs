// w19 activity: what he is doing decides whether a nudge goes. The decision table (gaming x time-critical x soft), the
// 30-minute repeat rule, and the wiring through the one delivery gate. Temp directories only: no live state is read or written.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { activityVerdict, isNudge, isTimeCritical, recentNudges, recordNudge, textKey, titleOf, REPEAT_MS } from "../scripts/lib/reach/activity-gate.mjs";
import { readActivity, nowLine, distractionOf, summarizeHistory } from "../scripts/lib/awareness/activity.mjs";
import { gate, resolveAwareness } from "../scripts/lib/reach/gate.mjs";

const NOW = new Date(2026, 10, 4, 18, 20);
const at = (min) => new Date(NOW.getTime() + min * 60_000).toISOString();
const mc = (over = {}) => ({ version: 1, at: at(-0.2), idleSeconds: 2, app: { name: "java", bundleId: null, pid: 9 }, category: "game", game: { name: "Minecraft", since: at(-40) }, domain: null, siteCategory: null, ...over });
const yt = () => ({ version: 1, at: at(-0.2), idleSeconds: 2, app: { name: "Safari", bundleId: "com.apple.Safari", pid: 1 }, category: "browser", game: null, domain: "youtube.com", siteCategory: "video" });
const code = () => ({ version: 1, at: at(-0.2), idleSeconds: 2, app: { name: "Code", bundleId: "com.microsoft.VSCode", pid: 2 }, category: "work", game: null, domain: null, siteCategory: null });
const SOFT = { kind: "checkin", why: "plan: cal-resume", text: "Time to start: Resume." };
const CLASS = { kind: "reminder", urgentKind: "class", why: "proactive: leave-1530", text: "Leave in 10 min for CS2100 at 3:30 PM." };
const dir = (files = {}) => { const d = mkdtempSync(join(tmpdir(), "act-")); for (const [n, b] of Object.entries(files)) writeFileSync(join(d, n), typeof b === "string" ? b : JSON.stringify(b)); return d; };

test("decision table: soft plan item", () => {
  // gaming: one gentle line that adapts the plan
  const g = activityVerdict({ activity: mc(), msg: SOFT, now: NOW });
  assert.equal(g.action, "deliver");
  assert.match(g.text, /^You're in Minecraft - want me to push resume to 8:00 PM\?$/);
  // watching video: the same
  assert.match(activityVerdict({ activity: yt(), msg: SOFT, now: NOW }).text, /^You're watching YouTube - want me to push resume/);
  // working: as written
  const w = activityVerdict({ activity: code(), msg: SOFT, now: NOW });
  assert.equal(w.action, "deliver"); assert.equal(w.text, undefined);
  // nothing known: as written
  assert.equal(activityVerdict({ activity: null, msg: SOFT, now: NOW }).text, undefined);
});

test("decision table: time-critical owns what he is doing and always goes", () => {
  const g = activityVerdict({ activity: mc(), msg: CLASS, now: NOW });
  assert.equal(g.action, "deliver");
  assert.equal(g.text, "I know you're in Minecraft, but leave in 10 min for CS2100 at 3:30 PM.");
  for (const msg of [{ ...SOFT, tier: "protected", text: "Resume didn't happen at 4:00 PM. Want 30 min tonight?" }, { ...SOFT, why: "proactive: deadline-cs", kind: "question", text: "Your CS2100 submission is due in 2 hours." }]) {
    const v = activityVerdict({ activity: mc(), msg, recent: [{ key: "java|", text: textKey(msg.text), at: at(-1) }], now: NOW });
    assert.equal(v.action, "deliver", msg.text);       // even right after the same line: a repeat rule never blocks a critical one
    assert.match(v.text, /^I know you're in Minecraft, but /);
  }
  assert.equal(activityVerdict({ activity: code(), msg: CLASS, now: NOW }).text, undefined);   // not gaming: plain
});

test("the 30-minute rule: one gentle line, then back off while nothing changes", () => {
  const key = "java|";
  const first = activityVerdict({ activity: mc(), msg: SOFT, recent: [], now: NOW });
  assert.equal(first.action, "deliver");
  const recent = [{ key, text: textKey(first.text), at: at(-1) }];
  const other = { ...SOFT, text: "Resume - still not started. Just 30 min then." };
  const second = activityVerdict({ activity: mc(), msg: other, recent, now: NOW });
  assert.deepEqual([second.action, second.heldFor, second.drop], ["hold", "activity", true]);
  // the activity changed: he is on something else, so a nudge may go
  assert.equal(activityVerdict({ activity: yt(), msg: other, recent, now: NOW }).action, "deliver");
  // the window passed
  assert.equal(recentNudges(dir({ "activity-nudges.jsonl": JSON.stringify({ at: at(-31), key, text: "x" }) }), NOW).length, 0);
  assert.equal(REPEAT_MS, 30 * 60_000);
});

test("an identical nudge is not repeated within 30 min even when he is working", () => {
  const recent = [{ key: "com.microsoft.VSCode|", text: textKey("Time to start: Resume."), at: at(-10) }];
  const v = activityVerdict({ activity: code(), msg: SOFT, recent, now: NOW });
  assert.deepEqual([v.action, v.drop], ["hold", true]);
  // a different line goes
  assert.equal(activityVerdict({ activity: code(), msg: { ...SOFT, text: "Gym at 7:00 PM." }, recent, now: NOW }).action, "deliver");
  // and a count that ticks up is still the same line
  assert.equal(textKey("It's been 20 min. Gym, now."), textKey("It's been 30 min. Gym, now."));
});

test("sleep lines, the brief and answers are never about what he is doing", () => {
  for (const why of ["proactive: bed-wind", "proactive: session-done-s1", "curiosity: review-x", "morning"]) {
    const v = activityVerdict({ activity: mc(), msg: { kind: "reminder", why, text: "Bed at 12:00 AM. Start wrapping up." }, recent: [{ key: "java|", text: "x", at: at(-1) }], now: NOW });
    assert.deepEqual([v.action, v.text], ["deliver", undefined], why);
  }
  assert.equal(isNudge({ why: "proactive: due-essay" }), true);
  assert.equal(isNudge({ why: "proactive: bed-now" }), false);
  assert.equal(isNudge({ why: null }), false);
  assert.equal(isTimeCritical({ kind: "info", text: "mail from mum" }), false);
});

test("away from the keys is not gaming: the game is only left open", () => {
  assert.equal(distractionOf(mc({ idleSeconds: 600 })), null);
  assert.equal(activityVerdict({ activity: mc({ idleSeconds: 600 }), msg: SOFT, now: NOW }).text, undefined);
});

test("titleOf reads the block's name from the ladder shapes", () => {
  assert.equal(titleOf("Time to start: Gym."), "gym");
  assert.equal(titleOf("Resume — still not started. Just 30 min then, and it starts now."), "resume");
  assert.equal(titleOf("It's been 20 min. Gym, now. Phone down, 30 min still counts."), "gym");
  assert.equal(titleOf("hello"), null);
});

test("through the one gate: resolveAwareness reads the file, gate holds the second and rewrites the first", () => {
  const d = dir({ "activity.json": mc() });
  const aw = () => resolveAwareness({ dir: d, now: NOW, env: {}, probe: false });
  assert.equal(aw().activity.game.name, "Minecraft");
  const first = gate(aw(), { kind: "checkin", why: "plan: cal-resume", text: SOFT.text, now: NOW });
  assert.equal(first.action, "deliver");
  assert.match(first.text, /^You're in Minecraft/);
  recordNudge(d, { activity: aw().activity, text: SOFT.text, why: SOFT.why, now: NOW });   // the ORIGINAL text, the one the gate compares
  const again = gate(aw(), { kind: "checkin", why: "plan: cal-resume", text: "Resume - still not started. Just 30 min then.", now: new Date(NOW.getTime() + 10 * 60_000) });
  assert.deepEqual([again.action, again.heldFor, again.drop], ["hold", "activity", true]);
  const cls = gate(aw(), { kind: "reminder", urgentKind: "class", why: "proactive: leave", text: CLASS.text, now: NOW });
  assert.equal(cls.action, "deliver"); assert.match(cls.text, /^I know you're in Minecraft, but leave in 10 min/);
});

test("a stale or broken activity file changes nothing", () => {
  for (const files of [{ "activity.json": mc({ at: at(-30) }) }, { "activity.json": "garbage" }, {}]) {
    const aw = resolveAwareness({ dir: dir(files), now: NOW, env: {}, probe: false });
    assert.equal(aw.activity, null);
    assert.deepEqual(gate(aw, { kind: "checkin", why: "plan: x", text: SOFT.text, now: NOW }), { action: "deliver", reason: "nothing is in the way" });
  }
});

test("the Right now line and the history summary", () => {
  assert.equal(nowLine(mc(), { now: NOW }), "Right now: playing Minecraft for 40 min");
  assert.equal(readActivity(dir({ "activity.json": mc() }), NOW).app.name, "java");
  const rows = [{ at: at(-100), bundleId: "com.microsoft.VSCode", category: "work", domain: null }, { at: at(-60), bundleId: "java", category: "game", domain: null }];
  const s = summarizeHistory(rows, { now: NOW });
  assert.equal(s.categories.find((c) => c.name === "work").minutes, 30);
  assert.equal(s.categories.find((c) => c.name === "game").minutes, 30);
});

test("time-critical wording: leave, head out, late for, and lines tagged leave or deadline", () => {
  for (const text of ["Time to leave for CS2100.", "You should head out now for class.", "Leave now, the bus is at 3:10.", "You're going to be late for your seminar.", "Out the door in five."])
    assert.equal(isTimeCritical({ kind: "checkin", why: "proactive: x", text }), true, text);
  for (const why of ["proactive: leave-930", "proactive: deadline-cs2100", "plan: leave-late-1020"]) assert.equal(isTimeCritical({ kind: "checkin", why, text: "x" }), true, why);
  for (const kind of ["leave", "deadline"]) assert.equal(isTimeCritical({ kind, text: "x" }), true, kind);
  assert.equal(isTimeCritical({ kind: "checkin", why: "plan: cal-resume", text: "Time to start: Resume." }), false);
  assert.match(activityVerdict({ activity: mc(), msg: { kind: "checkin", why: "proactive: x", text: "Time to leave for CS2100." }, now: NOW }).text, /^I know you're in Minecraft, but time to leave/);
});

test("recordNudge records real nudges only, never replies, briefs or critical lines", () => {
  const d = dir();
  const act = mc();
  recordNudge(d, { activity: act, text: "You asked about Minecraft", why: null, now: NOW });                     // a reply
  recordNudge(d, { activity: act, text: "Morning. Brief.", why: "morning", now: NOW });                          // the brief
  recordNudge(d, { activity: act, text: "Leave in 10 min.", why: "proactive: leave-1530", urgentKind: "class", now: NOW });   // critical
  assert.equal(recentNudges(d, NOW).length, 0);
  recordNudge(d, { activity: act, text: SOFT.text, why: SOFT.why, now: NOW });
  assert.equal(recentNudges(d, NOW).length, 1);
});

test("dedupe compares the original text on both sides: the rewritten line is never what is stored", () => {
  const d = dir({ "activity.json": mc() });
  const aw = () => resolveAwareness({ dir: d, now: NOW, env: {}, probe: false });
  const v = gate(aw(), { kind: "checkin", why: SOFT.why, text: SOFT.text, now: NOW });
  assert.match(v.text, /^You're in Minecraft/);
  recordNudge(d, { activity: aw().activity, text: SOFT.text, why: SOFT.why, now: NOW });
  assert.equal(recentNudges(d, NOW)[0].text, textKey(SOFT.text));
  const same = activityVerdict({ activity: mc(), recent: recentNudges(d, NOW), msg: SOFT, now: NOW });
  assert.deepEqual([same.action, same.drop], ["hold", true]);
});
