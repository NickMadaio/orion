// The names he uses for blocks, script side (gate run-1031224700, wave 5). "marketing" is MKTG2201, "macro" ECON1115, "side project
// tonight" the Side project block. lib/life/block-names.mjs is the scripts' copy of the plugin's block-names.ts; the shared fixture
// keeps them equal. Fixtures only: a fake bridge, a temp home (so no USER.md or brain is read), fictional course data.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { coursesInText, loadCourseAliases, namesTitle } from "../scripts/lib/life/block-names.mjs";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
const cases = JSON.parse(readFileSync(join(ROOT, "tests/fixtures/block-names-cases.json"), "utf8"));
const aliases = new Map(Object.entries(cases.aliases));

for (const [name, title, want] of cases.match) {
  test(`"${name}" ${want ? "names" : "does not name"} ${title} (same as the plugin)`, () => assert.equal(namesTitle(name, title, aliases), want));
}

test("course subjects come from data files, parsed and merged", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "orion-bn-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const courses = join(dir, "Courses"); mkdirSync(courses);
  writeFileSync(join(dir, "USER.md"), "Classes: GEOG1200 Rivers, ARTS3000 is Studio Practice 2.");
  writeFileSync(join(courses, "PSYC1100.md"), "- [name] Principles of Cognition\n");
  writeFileSync(join(dir, "life.json"), JSON.stringify({ courses: { MUSC1001: "Introduction to Harmony" } }));
  const got = loadCourseAliases({ userMd: join(dir, "USER.md"), coursesDir: courses, lifeConfig: join(dir, "life.json") });
  assert.deepEqual(Object.fromEntries(got), { geog1200: ["rivers"], arts3000: ["studio", "practice"], psyc1100: ["cognition"], musc1001: ["harmony"] });
  assert.deepEqual([...coursesInText("nothing here").keys()], []);
});

const at = (h, m = 0) => new Date(2030, 9, 3, h, m).toISOString().replace(/\.\d{3}Z$/, "Z");
const clock = (iso) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
function world(t, events) {
  const home = mkdtempSync(join(tmpdir(), "orion-w5-alias-"));
  t.after(() => rmSync(home, { recursive: true, force: true }));
  const controlled = join(home, ".openclaw/orion-controlled"); mkdirSync(controlled, { recursive: true });
  writeFileSync(join(home, "life.json"), JSON.stringify({ bufferMinutes: 5, ranks: { gym: "must" }, anchors: [{ title: "Gym", kind: "gym", minutes: 90, days: [1, 2, 3, 4, 5, 6, 7], rank: "must" }] }));
  const calendar = join(home, "calendar.json");
  writeFileSync(calendar, JSON.stringify(events.map((e, i) => ({ identifier: `seed-${i}`, ...e }))));
  const run = (now, ...args) => {
    const iso = new Date(2030, 9, 3, ...now).toISOString();
    const r = spawnSync(process.execPath, [join(ROOT, "scripts/orion-reschedule"), ...args, "--date", "2030-10-03"], { encoding: "utf8", env: { ...process.env, HOME: home, ORION_CONTROLLED_DIR: controlled,
      ORION_WORKSPACE_DIR: join(home, "ws"), ORION_BRAIN_VAULT: join(home, "brain"),
      ORION_BRIDGE_BIN: join(ROOT, "tests/fixtures/fake-bridge.mjs"), FAKE_CALENDAR: calendar, ORION_LIFE_CONFIG: join(home, "life.json"), ORION_RESCHEDULE_UNDO: join(home, "undo.json"),
      ORION_RESCHEDULE_PINS: join(home, "pins.json"), ORION_RESCHEDULE_NOW: iso, ORION_REACH_NOW: iso } });
    return { code: r.status, out: `${r.stdout}${r.stderr}` };
  };
  const day = () => JSON.parse(readFileSync(calendar, "utf8")).map((e) => `${e.title} ${clock(e.start)}-${clock(e.end)}${e.notes && /cancel/i.test(e.notes) ? " cancelled" : ""}`);
  return { run, day };
}
const DAY = [
  { title: "ECON1115", start: at(11), end: at(12, 30) },
  { title: "MKTG2201", start: at(13, 30), end: at(15, 30) },
  { title: "Gym", start: at(17), end: at(18, 30), orion: "gym", orionTags: "gym" },
  { title: "Side project", start: at(19, 30), end: at(20, 30), orion: "side_project", orionTags: "side_project" },
];

test("drop 'side project tonight' takes off the Side project block", (t) => {
  const w = world(t, DAY);
  const r = w.run([10], "drop", "side project tonight");
  assert.equal(r.code, 0, r.out);
  assert.ok(!w.day().some((l) => /^Side project/.test(l)), w.day().join("\n"));
});

test("move gym --after 'marketing' lands after MKTG2201", (t) => {
  const w = world(t, DAY);
  const r = w.run([10], "move", "gym", "--after", "my marketing class");
  assert.equal(r.code, 0, r.out);
  const gym = w.day().find((l) => /^Gym /.test(l));
  assert.match(gym, /^Gym 15:3\d-17:0\d$/, w.day().join("\n"));
});

test("classes-off by subject: 'macro' and 'mktg' are ECON1115 and MKTG2201", (t) => {
  const w = world(t, DAY);
  const r = w.run([10], "classes-off", "macro", "mktg");
  assert.equal(r.code, 0, r.out);
  assert.match(r.out, /cancelled ECON1115/);
  assert.match(r.out, /cancelled MKTG2201/);
});

test("wave 4 still holds: 'cs lab' does not take off DS Lab 05", (t) => {
  const w = world(t, [...DAY, { title: "DS Lab 05", start: at(16), end: at(16, 45), orion: "study", orionTags: "study" }]);
  const r = w.run([10], "drop", "cs lab");
  assert.notEqual(r.code, 0, r.out);
  assert.ok(w.day().some((l) => /^DS Lab 05/.test(l)), w.day().join("\n"));
});
