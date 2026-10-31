// The now record (2026-10-30): one decision record of what Nick should be doing now and next, which every surface reads.
// Pure function, injected inputs; local-time fixtures (no /Users paths, no real clock).
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { nowRecord, NOW_SCHEMA_VERSION, RECORD_KEYS, MISMATCH_KINDS } from "../scripts/lib/life/now-record.mjs";
import { writeNowRecord, readNowRecord, sleepPlanFor, sensorsFrom, NOW_FILE } from "../scripts/lib/life/now-state.mjs";
import { addDeclaredFact, readDeclaredFacts, factsFor, cancels, DECLARED_KINDS } from "../scripts/lib/awareness/declared-facts.mjs";

const DATE = "2026-10-30";
const at = (h, m = 0) => new Date(2026, 9, 30, h, m);
const iso = (h, m = 0) => at(h, m).toISOString();
const M = (h, m = 0) => h * 60 + m;
const block = (id, title, kind, start, end, extra = {}) => ({ id, title, kind, date: DATE, start, end, fixed: false, source: "orion", ...extra });
const cls = (id, title, start, end) => block(id, title, "class", start, end, { fixed: true, source: "calendar" });
const gym = block("gym", "Gym", "gym", M(12), M(13, 30), { rank: "must" });
const mktg = cls("mktg", "MKTG2201 Introduction to Marketing — Lecture", M(13, 30), M(15));
const econ = cls("econ", "ECON1115 Principles of Macroeconomics — Lecture", M(15, 30), M(17));

/** A C1 awareness snapshot at `now`, everything fresh and neutral unless overridden. */
const aware = (now, over = {}) => {
  const a = now.toISOString();
  return { schema: "orion.awareness.v1", at: a,
    session: { state: "none", sessionId: null, task: null, at: a }, calendar: { state: "ok", now: null, next: null, at: a },
    location: { state: "unknown", placeId: null, since: null, at: null, homeKnown: true }, mac: { state: "active", idleSeconds: 4, frontApp: "Safari", workApp: null, at: a },
    phone: { state: "unknown", lastSampleAt: "2026-10-26T18:03:46Z", at: "2026-10-26T18:03:46Z" },
    audio: { mac: { route: "speakers", headphones: false, at: a }, phone: { route: "unknown", at: null } },
    sleep: { state: "awake", inWindow: false, wokeAt: M(8, 30), bed: 1440, source: "whoop", at: a },
    derived: { activity: "free", atMac: true, atHome: null }, ...over };
};
const base = (now, over = {}) => ({ now, aw: aware(now), day: [gym, mktg, econ], dayOk: true, config: { commuteMinutes: 45 },
  sleepPlan: { bedtime: "00:00", wake: "09:00" }, slips: [], declared: [], checkins: [], patterns: null,
  sensors: { phone: "2026-10-26T18:03:46Z", mac: now.toISOString(), whoop: "2026-10-30T08:30:00Z" }, ...over });

test("the record has exactly the contract's keys, version 1, and computedAt is the injected clock", () => {
  const r = nowRecord(base(at(12, 40)));
  assert.equal(NOW_SCHEMA_VERSION, 1);
  assert.deepEqual(Object.keys(r).sort(), [...RECORD_KEYS].sort());
  assert.deepEqual([...RECORD_KEYS].sort(), ["computedAt", "declared", "is", "mismatch", "next", "schemaVersion", "sensors", "shouldBe", "sleepPlan", "slipsToday", "strictness"]);
  assert.equal(r.schemaVersion, 1);
  assert.equal(r.computedAt, iso(12, 40));
  assert.deepEqual(Object.keys(r.shouldBe).sort(), ["blockId", "end", "kind", "start", "title", "why"]);
  assert.deepEqual(Object.keys(r.is).sort(), ["activity", "confidence", "evidence", "focusSession", "place"]);
  assert.deepEqual(Object.keys(r.sensors).sort(), ["mac", "phone", "whoop"]);
  assert.deepEqual(MISMATCH_KINDS, ["not-started", "off-plan", "awake-late", "missed", "overrun"]);
});

test("12:40, gym planned 12:00-13:30 and nothing says he started: should be at the gym, not started for 40 min, firm", () => {
  const r = nowRecord(base(at(12, 40), { day: [gym, econ] }));
  assert.equal(r.shouldBe.kind, "gym");
  assert.equal(r.shouldBe.title, "Gym");
  assert.equal(r.shouldBe.blockId, "gym");
  assert.equal(r.shouldBe.start, iso(12));
  assert.equal(r.shouldBe.end, iso(13, 30));
  assert.deepEqual(r.mismatch, { kind: "not-started", since: iso(12), minutes: 40 });
  assert.equal(r.strictness, "firm", "40 min late on a must block");
  assert.equal(r.next.title, econ.title);
  assert.equal(r.next.start, iso(15, 30));
  assert.equal(r.next.leaveBy, iso(14, 45), "45 min commute before the first class");
  assert.equal(r.is.activity, "at-mac");
  assert.equal(r.is.confidence, "medium");
});

test("the commute to class starts within 15 min: get ready to leave, even over a planned block (classes come first)", () => {
  const r = nowRecord(base(at(12, 40)));
  assert.equal(r.shouldBe.kind, "prepare");
  assert.equal(r.shouldBe.blockId, "mktg");
  assert.equal(r.shouldBe.end, iso(12, 45));
  assert.match(r.shouldBe.why, /Leave at 12:45/);
  assert.equal(r.mismatch, null);
  assert.equal(r.next.title, mktg.title);
  assert.equal(r.next.leaveBy, iso(12, 45));
});

test("five minutes in is not yet a mismatch, and a short lag is flexible", () => {
  const r = nowRecord(base(at(12, 3)));
  assert.equal(r.mismatch, null);
  assert.equal(r.strictness, "flexible");
});

test("a focus session on the block's task is evidence: no mismatch, high confidence", () => {
  const now = at(12, 40);
  const r = nowRecord(base(now, { aw: aware(now, { session: { state: "focus", sessionId: "s1", task: "Gym", phaseEndsAt: iso(13), at: now.toISOString() } }) }));
  assert.equal(r.mismatch, null);
  assert.equal(r.is.activity, "focus");
  assert.equal(r.is.confidence, "high");
  assert.deepEqual(r.is.focusSession, { state: "focus", task: "Gym", endsAt: iso(13), sessionId: "s1" });
  assert.ok(r.is.evidence.some((e) => /session/.test(e)));
});

test("being at the gym (location) is evidence for the gym block", () => {
  const now = at(12, 40);
  const r = nowRecord(base(now, { aw: aware(now, { location: { state: "known", placeId: "gym", since: iso(12, 5), at: now.toISOString(), homeKnown: true } }) }));
  assert.equal(r.mismatch, null);
  assert.equal(r.is.place, "gym");
});

test("inside the commute wall before a class: head out, and still at home after it began is not-started", () => {
  const now = at(13, 0);
  const r = nowRecord(base(now, { day: [mktg, econ] }));
  assert.equal(r.shouldBe.kind, "travel");
  assert.equal(r.shouldBe.blockId, "mktg");
  assert.equal(r.shouldBe.start, iso(12, 45));
  assert.equal(r.shouldBe.end, iso(13, 30));
  assert.equal(r.mismatch, null, "location unknown: unknown is never evidence of a mismatch");
  const home = nowRecord(base(now, { day: [mktg, econ], aw: aware(now, { location: { state: "home", placeId: "home", since: iso(9), at: now.toISOString(), homeKnown: true }, derived: { activity: "free", atMac: true, atHome: true } }) }));
  assert.deepEqual(home.mismatch, { kind: "not-started", since: iso(12, 45), minutes: 15 });
});

test("he said 'no classes today': classes drop out of shouldBe and next, the fact is carried, travel goes too", () => {
  const now = at(13, 20);
  const declared = [{ id: "f1", date: DATE, at: iso(10, 32), kind: "no-classes", text: "I don't have classes today", source: "chat" }];
  const r = nowRecord(base(now, { day: [gym, mktg, econ], declared }));
  assert.notEqual(r.shouldBe.kind, "travel");
  assert.notEqual(r.shouldBe.blockId, "mktg");
  assert.equal(r.shouldBe.blockId, "gym", "the gym block still runs to 13:30");
  assert.equal(r.next.kind, "sleep", "nothing else planned: next is bed");
  assert.equal(r.next.leaveBy, undefined);
  assert.deepEqual(r.declared, [{ id: "f1", kind: "no-classes", text: "I don't have classes today", at: iso(10, 32), source: "chat" }]);
  // and without the fact the same moment is the commute to class: classes outrank the gym (ORION_PURPOSE priorities)
  assert.equal(nowRecord(base(now, { day: [gym, mktg, econ] })).shouldBe.kind, "travel");
});

test("17:30 with nothing left: free until bed, side-project hour missing is in why", () => {
  const r = nowRecord(base(at(17, 30), { checkins: [{ block: "gym", loop: { phase: "done" } }] }));
  assert.equal(r.shouldBe.kind, "free");
  assert.equal(r.shouldBe.end, new Date(2026, 9, 31, 0, 0).toISOString());
  assert.match(r.shouldBe.why, /side.project/i);
  assert.equal(r.mismatch, null);
  assert.equal(r.next.kind, "sleep");
});

test("a study block that ended without happening comes back as missed", () => {
  const study = block("st", "Study for CS midterm", "study", M(10), M(11));
  const r = nowRecord(base(at(11, 30), { day: [study] }));
  assert.equal(r.shouldBe.blockId, "st");
  assert.deepEqual(r.mismatch, { kind: "missed", since: iso(11), minutes: 30 });
});

test("still in a focus session on a block that ended: overrun", () => {
  const now = at(13, 50);
  const lab = block("lab", "CS Lab", "study", M(12), M(13, 30));
  const nap = block("nap", "Nap", "rest", M(13, 30), M(14, 30));
  const r = nowRecord(base(now, { day: [lab, nap], aw: aware(now, { session: { state: "focus", sessionId: "s", task: "CS Lab", at: now.toISOString() } }) }));
  assert.deepEqual(r.mismatch, { kind: "overrun", since: iso(13, 30), minutes: 20 });
});

test("off plan: away from home for 20 min during a home block", () => {
  const now = at(12, 40);
  const write = block("w", "finish resume", "other", M(12, 30), M(13, 30));
  const r = nowRecord(base(now, { day: [write], aw: aware(now, { location: { state: "elsewhere", placeId: null, since: iso(12, 15), at: now.toISOString(), homeKnown: true } }) }));
  assert.deepEqual(r.mismatch, { kind: "off-plan", since: iso(12, 15), minutes: 25 });
});

test("awake at 01:30 after a midnight bedtime: should be asleep, awake-late for 90 min, firm", () => {
  const now = new Date(2026, 9, 31, 1, 30);
  const r = nowRecord(base(now, { day: [], aw: aware(now, { sleep: { state: "late-awake", inWindow: true, at: now.toISOString() } }) }));
  assert.equal(r.shouldBe.kind, "sleep");
  assert.equal(r.shouldBe.start, new Date(2026, 9, 31, 0, 0).toISOString());
  assert.equal(r.shouldBe.end, new Date(2026, 9, 31, 9, 0).toISOString());
  assert.deepEqual(r.mismatch, { kind: "awake-late", since: new Date(2026, 9, 31, 0, 0).toISOString(), minutes: 90 });
  assert.equal(r.strictness, "firm");
});

test("asleep in his window: should be asleep, no mismatch", () => {
  const now = new Date(2026, 9, 31, 3, 0);
  const r = nowRecord(base(now, { day: [], aw: aware(now, { sleep: { state: "asleep", inWindow: true, source: "declared", at: now.toISOString() } }) }));
  assert.equal(r.shouldBe.kind, "sleep");
  assert.equal(r.mismatch, null);
  assert.equal(r.is.activity, "sleeping");
});

test("an unreadable calendar is unknown, never free, and never a mismatch", () => {
  const r = nowRecord(base(at(12, 40), { day: [], dayOk: false }));
  assert.equal(r.shouldBe.kind, "unknown");
  assert.equal(r.mismatch, null);
});

test("slipsToday keeps only today's rows, in the record's shape", () => {
  const slips = [
    { date: "2026-10-27", at: "2026-10-27T08:28:02Z", planned: { title: "finish resume", start: 1070, end: 1160, kind: "other", rank: "medium" }, missedMinutes: 90, replacedBy: "Gym", reason: "no-room" },
    { date: DATE, at: "2026-10-30T10:31:47Z", planned: { title: "practice leetcode", start: M(21, 20), end: M(22, 20), kind: "other", rank: "low" }, missedMinutes: 60, replacedBy: "Gym", reason: "no-room" },
  ];
  const r = nowRecord(base(at(12, 40), { slips }));
  assert.deepEqual(r.slipsToday, [{ title: "practice leetcode", kind: "other", rank: "low", start: iso(21, 20), end: iso(22, 20), reason: "no-room", missedMinutes: 60, replacedBy: "Gym", at: "2026-10-30T10:31:47Z" }]);
});

test("a slip on today's kind makes a small lag firm; a learned low completion rate does too", () => {
  const slips = [{ date: DATE, at: iso(9), planned: { title: "Gym", start: M(8), end: M(9), kind: "gym" }, missedMinutes: 60, reason: "gave-up" }];
  assert.equal(nowRecord(base(at(12, 10), { slips })).strictness, "firm");
  const patterns = { byKind: { gym: { planned: 6, happened: 0, rate: 0 } } };
  assert.equal(nowRecord(base(at(12, 10), { patterns })).strictness, "firm");
  assert.equal(nowRecord(base(at(12, 10))).strictness, "flexible");
});

test("sensors: last sample and staleness per source; missing is stale", () => {
  const r = nowRecord(base(at(12, 40), { sensors: { phone: "2026-10-26T18:03:46Z", mac: iso(12, 39), whoop: null } }));
  assert.deepEqual(r.sensors.phone, { lastSampleAt: "2026-10-26T18:03:46Z", stale: true });
  assert.deepEqual(r.sensors.mac, { lastSampleAt: iso(12, 39), stale: false });
  assert.deepEqual(r.sensors.whoop, { lastSampleAt: null, stale: true });
});

test("pure: frozen inputs are not mutated and the same inputs give the same record", () => {
  const deep = (o) => { Object.freeze(o); for (const v of Object.values(o)) if (v && typeof v === "object" && !Object.isFrozen(v)) deep(v); return o; };
  const input = deep(base(at(12, 40), { slips: [{ date: DATE, at: iso(9), planned: { title: "x", start: 1, end: 2, kind: "other" } }] }));
  assert.deepEqual(nowRecord(input), nowRecord(input));
});

// ---- producer helpers --------------------------------------------------------------------------------
test("sleepPlanFor: wake 75 min before tomorrow's first fixed thing, never after 09:00; bed 8 h before, never after midnight", () => {
  assert.deepEqual(sleepPlanFor({ minute: M(12), tomorrow: [cls("c", "CS2100", M(9), M(10, 30))] }), { bedtime: "23:45", wake: "07:45" });
  assert.deepEqual(sleepPlanFor({ minute: M(12), tomorrow: [] }), { bedtime: "00:00", wake: "09:00" });
});

test("sensorsFrom: phone from awareness or the health log, mac from awareness, WHOOP from the nights and today's record", () => {
  const s = sensorsFrom({ aw: aware(at(12, 40)), healthLog: { phoneSignals: [{ at: "2026-10-26T18:03:46Z" }], days: { [DATE]: { updatedAt: "2026-10-30T10:46:45Z" } } },
    nights: [{ wokeAt: "2026-10-30T08:30:00Z" }] });
  assert.deepEqual(s, { phone: "2026-10-26T18:03:46Z", mac: iso(12, 40), whoop: "2026-10-30T10:46:45Z" });
});

test("now.json round trip: written atomically, read back; another version is refused, not guessed at", () => {
  const dir = mkdtempSync(join(tmpdir(), "orion-now-"));
  const r = nowRecord(base(at(12, 40)));
  writeNowRecord(dir, r);
  assert.deepEqual(readNowRecord(dir), r);
  writeFileSync(join(dir, NOW_FILE), JSON.stringify({ ...r, schemaVersion: 2 }));
  assert.equal(readNowRecord(dir), null);
});

// ---- declared facts ------------------------------------------------------------------------------------
test("declared facts: added, de-duplicated per day, only today's are returned, and a no-classes fact cancels classes", () => {
  const dir = mkdtempSync(join(tmpdir(), "orion-declared-"));
  assert.ok(DECLARED_KINDS.includes("no-classes"));
  const f = addDeclaredFact(dir, { kind: "no-classes", text: "I don't have classes today", source: "chat" }, at(10, 32));
  addDeclaredFact(dir, { kind: "no-classes", text: "i dont have classes today", source: "chat" }, at(13, 32));
  addDeclaredFact(dir, { kind: "note", text: "lab still to do", source: "chat" }, new Date(2026, 9, 29, 20));
  const today = readDeclaredFacts(dir, { date: DATE });
  assert.equal(today.length, 1);
  assert.equal(today[0].id, f.id);
  assert.equal(today[0].date, DATE);
  assert.equal(cancels(today, mktg), true);
  assert.equal(cancels(today, gym), false);
  assert.equal(factsFor(readDeclaredFacts(dir), "2026-10-29").length, 1);
  assert.throws(() => addDeclaredFact(dir, { kind: "made-up", text: "x" }, at(9)), /kind/);
  assert.throws(() => addDeclaredFact(dir, { kind: "note", text: "" }, at(9)), /text/);
  const skip = [{ kind: "skip", date: DATE, title: "Gym", text: "skipping gym" }];
  assert.equal(cancels(skip, gym), true);
  assert.equal(cancels(skip, mktg), false);
});

// ---- orion-now --json prints the same record, at a fake time, against a state dir ------------------------
test("orion-now --json: the record at ORION_NOW from ORION_CONTROLLED_DIR, and the human line still works", () => {
  const home = mkdtempSync(join(tmpdir(), "orion-now-cli-"));
  const dir = join(home, "state");
  mkdirSync(dir, { recursive: true });
  const now = at(12, 40);
  writeFileSync(join(dir, "awareness.json"), JSON.stringify(aware(now)));
  writeFileSync(join(dir, "life-config.json"), JSON.stringify({ commuteMinutes: 45 }));
  writeFileSync(join(home, "cal.json"), JSON.stringify([
    { identifier: "g", title: "Gym", start: iso(12), end: iso(13, 30), orion: "gym" },
    { identifier: "m", title: mktg.title, start: iso(13, 30), end: iso(15) }]));
  addDeclaredFact(dir, { kind: "no-classes", text: "I don't have classes today", source: "chat" }, at(10, 32));
  const env = { PATH: process.env.PATH, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_NOW: now.toISOString(), ORION_AWARENESS_NO_REFRESH: "1",
    ORION_BRIDGE_BIN: join(import.meta.dirname, "fixtures/fake-bridge.mjs"), FAKE_CALENDAR: join(home, "cal.json") };
  const run = (args) => spawnSync(process.execPath, [join(import.meta.dirname, "../scripts/orion-now"), ...args], { encoding: "utf8", env });
  const j = run(["--json"]);
  assert.equal(j.status, 0, j.stderr);
  const r = JSON.parse(j.stdout);
  assert.equal(r.schemaVersion, 1);
  assert.equal(r.computedAt, now.toISOString());
  assert.equal(r.shouldBe.title, "Gym");
  assert.equal(r.mismatch.kind, "not-started");
  assert.equal(r.declared[0].kind, "no-classes");
  assert.notEqual(r.next?.title, mktg.title, "the cancelled class is not next");
  assert.deepEqual(Object.keys(r.sleepPlan).sort(), ["bedtime", "wake"]);
  const h = run([]);
  assert.equal(h.status, 0, h.stderr);
  assert.match(h.stdout, /^It's 12:40\./);
  assert.match(h.stdout, /Gym/);
  assert.equal(readFileSync(join(home, "cal.json"), "utf8").includes("Gym"), true);
});
