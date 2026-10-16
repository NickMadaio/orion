// The nightly review reads reality (spec 3.6, scenario 11): done, slipped, free, and unknown blanks; delivery by place.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { actualDay, actualText, blanks, reviewDay } from "../scripts/lib/life/day-review.mjs";
import { aw } from "./fixtures/curiosity-aw.mjs";

const m = (h, mm = 0) => h * 60 + mm;
const date = "2026-10-16";
const now = { date, minute: m(21) };
const cs = { id: "c1", title: "CS1800 Discrete Structures — Lecture", kind: "class", start: m(9), end: m(10, 30), fixed: true, source: "calendar" };
const gym = { id: "g1", title: "gym", kind: "gym", start: m(14), end: m(16), fixed: false, source: "orion", logged: true };
const walk = { id: "w1", title: "Evening walk", kind: "rest", start: m(19), end: m(19, 30), fixed: false, source: "orion" };
const inputs = () => ({
  blocks: [cs, gym, walk],
  focusHistory: [{ dayKey: date, startedAt: new Date(2026, 9, 16, 11).toISOString(), endedAt: new Date(2026, 9, 16, 12, 40).toISOString(), servedFocusSeconds: 6000, task: "the resume" }],
  attendance: { c1: "attended" },
  slips: [{ date, planned: { title: "finish resume", start: m(14), end: m(16), kind: "study", rank: "medium" }, missedMinutes: 120, replacedBy: "gym", reason: "reality" },
          { date, planned: { title: "YouTube", start: m(19), end: m(20), kind: "other", rank: "low" }, missedMinutes: 60, replacedBy: null, reason: "bumped:finish resume" }],
  asks: [{ askId: "a1", window: { date, start: m(17), end: m(18) }, answeredAt: "x", outcome: "nothing" }],
  now,
});

test("done, slipped, free and unknown: a logged gym, a served session, an attended class, a slip, a 'nothing', a 2 h blank", () => {
  const a = actualDay(inputs());
  assert.deepEqual(a.done.map((d) => [d.title, d.how]), [["gym", "logged"], ["CS1800 Discrete Structures — Lecture", "attended"]]);
  assert.equal(a.focusMinutes, 100);
  assert.deepEqual(a.slipped.map((s) => s.why), ["reality", "bumped:finish resume"]);
  assert.deepEqual(a.free, [{ start: m(17), end: m(18) }]);
  assert.deepEqual(a.blank, [[8, 0, 9, 0], [12, 40, 14, 0], [16, 0, 17, 0], [18, 0, 19, 0], [19, 30, 21, 0]].map(([h, mi, h2, m2]) => ({ start: m(h, mi), end: m(h2, m2) })));
});

test("a stretch nobody knows about is 'unknown', an answered 'nothing' is not, and the text says both", () => {
  const a = actualDay(inputs());
  const text = actualText(a);
  assert.match(text, /^Today: gym 2-4 \(instead of finish resume\), CS1800 Discrete Structures, 1h40 focus\./);
  assert.match(text, /Slipped: YouTube \(bumped for finish resume\)\./);
  assert.match(text, /unknown\.$/);
  assert.doesNotMatch(text, /5-6/, "5 to 6 was answered 'nothing'");
  assert.match(text, /12:40-2/, "12:40 to 2 is blank");
});

test("blanks(): over the minimum, from 08:00 to now; blocks, sessions and answers cover", () => {
  assert.deepEqual(blanks({ blocks: [{ start: m(9), end: m(10) }] }, { now: m(12) }), [{ start: m(8), end: m(9) }, { start: m(10), end: m(12) }].filter((b) => b.end - b.start > 30));
  assert.deepEqual(blanks({ blocks: [], answered: [{ start: m(8), end: m(12) }] }, { now: { minute: m(12) } }), []);
  assert.deepEqual(blanks({ blocks: [{ start: m(9), end: m(9, 20) }] }, { now: m(9, 40), minMinutes: 30 }), [{ start: m(8), end: m(9) }]);
});

test("a planned block that ended with no evidence and no slip is slipped; one with a served session is not", () => {
  const study = { id: "s", title: "Study macro", kind: "study", start: m(11), end: m(13), fixed: false, source: "orion" };
  const lab = { id: "l", title: "DS lab write-up", kind: "study", start: m(15), end: m(16), fixed: false, source: "orion" };
  const a = actualDay({ ...inputs(), blocks: [study, lab], slips: [], attendance: {}, asks: [] });
  assert.deepEqual(a.slipped.map((s) => s.title), ["DS lab write-up"], "the 11:00-12:40 session covers Study macro (a study block)");
});

test("reviewDay with actual uses reality; without it the old review is unchanged", () => {
  const out = reviewDay({ date, blocks: [gym], checkins: [], todosDone: [], now, actual: actualDay(inputs()) });
  assert.match(out.text, /^Today: gym 2-4/);
  assert.equal(reviewDay({ date, blocks: [], checkins: [], todosDone: [], now }).text, "Nothing was planned today.");
});

// ---- the CLI, end to end with a fake calendar and a stub orion-reach ------------------------------------------------
function world(awOver) {
  const home = mkdtempSync(join(tmpdir(), "orion-dr-"));
  const dir = join(home, "c"); mkdirSync(dir);
  const at = (h, mi) => new Date(2026, 9, 16, h, mi).toISOString();
  const cal = [{ identifier: "cs", title: cs.title, start: at(9, 0), end: at(10, 30) }, { identifier: "gym", title: "gym", start: at(14, 0), end: at(16, 0), orion: "gym" }];
  writeFileSync(join(home, "cal.json"), JSON.stringify(cal));
  const nowD = new Date(2026, 9, 16, 21, 0);
  writeFileSync(join(dir, "awareness.json"), JSON.stringify(aw(nowD, awOver)));
  writeFileSync(join(dir, "focus-history.jsonl"), `${JSON.stringify({ dayKey: date, startedAt: at(11, 0), endedAt: at(12, 40), servedFocusSeconds: 6000, task: "resume" })}\n`);
  writeFileSync(join(dir, "slips.jsonl"), `${JSON.stringify({ date, planned: { title: "finish resume" }, replacedBy: "gym", reason: "reality" })}\n`);
  writeFileSync(join(dir, "curiosity.json"), JSON.stringify({ asks: [{ askId: "a", type: "fill-blank", window: { date, start: m(17), end: m(18) }, answeredAt: "x", outcome: "nothing", at: at(20, 5) }], blankGapMinutes: 60, pausedUntil: null }));
  writeFileSync(join(dir, "health-log.json"), JSON.stringify({ phoneSignals: [{ at: at(8, 40), charging: false, motion: "walking" }] }));
  const stub = join(home, "reach.mjs"); writeFileSync(stub, `import { appendFileSync } from "node:fs"; appendFileSync(${JSON.stringify(join(home, "reach.log"))}, JSON.stringify(process.argv.slice(2)) + "\\n"); console.log("Sent - stub");`);
  const env = { PATH: process.env.PATH, HOME: home, ORION_CONTROLLED_DIR: dir, ORION_REACH_NOW: nowD.toISOString(), ORION_REACH_BIN: stub,
    ORION_BRIDGE_BIN: join(import.meta.dirname, "fixtures/fake-bridge.mjs"), FAKE_CALENDAR: join(home, "cal.json") };
  const run = (...args) => spawnSync(process.execPath, [join(import.meta.dirname, "../scripts/orion-day-review"), ...args], { encoding: "utf8", env });
  const sent = () => (existsSync(join(home, "reach.log")) ? readFileSync(join(home, "reach.log"), "utf8").trim().split("\n").map((l) => JSON.parse(l)) : []);
  return { run, sent, home };
}

test("orion-day-review --json lists done, slipped, free and the unknown stretches; nothing is written to the calendar", () => {
  const w = world();
  const r = w.run("--json");
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout);
  // (the `logged` flag on a block comes from WP6's live-day read of the [orion:logged] tag; a plain fake calendar has none)
  assert.deepEqual(out.done.map((d) => d.title), ["CS1800 Discrete Structures — Lecture"]);
  assert.equal(out.focusMinutes, 100);
  assert.deepEqual(out.free, [{ start: m(17), end: m(18) }]);
  assert.ok(out.blank.some((b) => b.start === m(16) && b.end === m(17)), JSON.stringify(out.blank));
  assert.equal(JSON.parse(readFileSync(join(w.home, "cal.json"), "utf8")).length, 2, "'nothing' created no calendar event");
});

test("delivery: at home it is spoken (--channel mac --loud --listen); away or unknown it is a text (--channel phone)", () => {
  const home = world();
  assert.equal(home.run("--send").status, 0);
  const a = home.sent()[0];
  assert.deepEqual(a.slice(a.indexOf("--channel"), a.indexOf("--channel") + 4), ["--channel", "mac", "--loud", "--listen"]);
  for (const over of [{ location: { state: "elsewhere", placeId: null, homeKnown: true } }, { location: { state: "unknown", placeId: null, homeKnown: true } }]) {
    const w = world(over);
    w.run("--send");
    const b = w.sent()[0];
    assert.equal(b[b.indexOf("--channel") + 1], "phone");
    assert.ok(!b.includes("--loud"));
  }
});
