// orion-knowledge (2026-10-30): what ORION knows about him, as a graph. Deterministic extraction from fixture
// files only — no LLM, no real home directory, no /Users paths (CI runs Linux).
import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { buildGraph } from "../scripts/lib/knowledge/build.mjs";

const FIXTURE = join(import.meta.dirname, "fixtures/knowledge/home");
const NOW = new Date("2026-10-30T14:00:00Z");
const noCalendar = () => ({ ok: false, note: "no Calendar access" });

function home() {
  const dir = mkdtempSync(join(tmpdir(), "orion-knowledge-"));
  cpSync(FIXTURE, dir, { recursive: true });
  return { workspaceDir: join(dir, "workspace"), controlledDir: join(dir, "controlled") };
}
const build = (dirs = home(), extra = {}) => buildGraph({ ...dirs, now: NOW, calendarProbe: noCalendar, ...extra });
const node = (g, id) => g.nodes.find((n) => n.id === id);
const edge = (g, a, b, kind) => g.edges.find((e) => e.kind === kind && ((e.from === a && e.to === b) || (e.from === b && e.to === a)));

test("every node type the view colours is extracted from the fixture files", () => {
  const g = build();
  const types = new Set(g.nodes.map((n) => n.type));
  for (const t of ["person", "place", "course", "project", "routine", "habit", "app", "health", "preference", "goal"]) {
    assert.ok(types.has(t), `no ${t} node`);
  }
  assert.equal(g.schema, "orion.knowledge-graph.v1");
  assert.equal(node(g, "person:self").label, "Sam");
});

test("courses come from USER.md with the calendar's names, and link to where they meet", () => {
  const g = build();
  const mktg = node(g, "course:mktg2201");
  assert.equal(mktg.label, "MKTG2201");
  assert.equal(mktg.subtitle, "Introduction to Marketing");
  const takes = edge(g, "person:self", "course:cs2100", "takes");
  assert.deepEqual(takes.source, { file: "workspace/USER.md", line: 16 });
  const meets = edge(g, "course:mktg2201", "place:devon-house", "meets-at");
  assert.equal(meets.source.file, "orion-controlled/glance-calendar.json");
  assert.match(meets.reason, /Devon House 122/);
});

test("places merge their aliases and carry the commute", () => {
  const g = build();
  const spit = node(g, "place:spitalfields");
  assert.deepEqual(spit.aliases, ["chapter spitalfields", "spit"]);
  assert.ok(spit.facts.some((f) => /15 min/.test(f.text)));
  assert.ok(!node(g, "place:spit"));
  assert.equal(edge(g, "person:self", "place:london", "lives-in").source.file, "orion-controlled/location.json");
});

test("routines, habits and the evidence behind them", () => {
  const g = build();
  assert.ok(edge(g, "routine:evening-out-2", "place:club", "happens-at"));
  const gym = node(g, "habit:gym");
  assert.ok(gym.facts.some((f) => /must/.test(f.text) && /90 min/.test(f.text)));
  assert.ok(gym.facts.some((f) => /0 of 6/.test(f.text)));
  assert.ok(node(g, "routine:wake").facts.some((f) => /10:31 AM/.test(f.text)));
  assert.ok(node(g, "habit:focus-sessions").facts.some((f) => /2 sessions/.test(f.text)));
});

test("daily notes connect what was said together, citing the date and line", () => {
  const g = build();
  const together = edge(g, "goal:finish-resume", "habit:gym", "said-together");
  assert.deepEqual(together.source, { file: "workspace/memory/2026-10-20.md", line: 5, date: "2026-10-20" });
  assert.match(together.reason, /actually do resume before gym/);
  assert.ok(edge(g, "course:cs2100", "habit:gym", "said-together"));
  assert.ok(edge(g, "app:xcode", "project:lumen", "said-together"));
  assert.ok(edge(g, "person:priya", "course:econ1115", "said-together"));
});

test("deadlines attach to their course, preferences to what they rank", () => {
  const g = build();
  assert.ok(edge(g, "goal:ae1-marketing-presentation", "course:mktg2201", "deadline-for"));
  assert.ok(!node(g, "goal:old-thing"), "a finished to-do is not a goal");
  assert.equal(node(g, "preference:times-are-12-hour").sources[0].line, 21);
  assert.ok(edge(g, "preference:planning-priorities", "habit:gym", "ranks"));
  assert.ok(node(g, "goal:external-executive-function"));
});

test("health is summarised, never raw HRV or resting heart rate", () => {
  const g = build();
  assert.ok(node(g, "health:sleep").facts.some((f) => /7\.0 h/.test(f.text)));
  assert.ok(node(g, "health:recovery").facts.some((f) => /moderate/.test(f.text)));
  const text = JSON.stringify(g);
  assert.ok(!/hrv|resting/i.test(text), "raw health signal leaked into the graph");
  assert.ok(node(g, "habit:magnesium"));
});

test("every edge has a reason and a source citation, and no absolute paths", () => {
  const g = build();
  assert.ok(g.edges.length > 15);
  for (const e of g.edges) {
    assert.ok(e.reason && e.source?.file, `edge without provenance: ${e.id}`);
    assert.ok(node(g, e.from) && node(g, e.to), `dangling edge ${e.id}`);
  }
  assert.ok(!/"\/(Users|home|tmp|var|private)\//.test(JSON.stringify(g)), "an absolute path reached the graph");
});

test("deterministic: the same files give byte-identical graphs", () => {
  const dirs = home();
  assert.equal(JSON.stringify(build(dirs)), JSON.stringify(build(dirs)));
});

test("missing sources degrade to a smaller graph and say so", () => {
  const empty = mkdtempSync(join(tmpdir(), "orion-knowledge-empty-"));
  const g = build({ workspaceDir: join(empty, "w"), controlledDir: join(empty, "c") });
  assert.deepEqual(g.nodes.map((n) => n.id), ["person:self"]);
  assert.ok(g.sources.every((s) => s.ok === false || s.id === "calendar"));
  const cal = build().sources.find((s) => s.id === "calendar");
  assert.match(cal.note, /no Calendar access.*glance-calendar\.json/);
});

test("a live calendar read is used when the probe succeeds", () => {
  const g = build(home(), { calendarProbe: () => ({ ok: true, blocks: [{ kind: "class", title: "CS1800 Discrete Structures", location: "Online" }] }) });
  assert.equal(node(g, "course:cs1800").subtitle, "Discrete Structures");
  assert.equal(edge(g, "course:cs1800", "place:online", "meets-at").source.file, "calendar (orion-reschedule show)");
});

test("his edits in knowledge-overrides.json win on every rebuild", () => {
  const dirs = home();
  writeFileSync(join(dirs.controlledDir, "knowledge-overrides.json"), JSON.stringify({
    schema: "orion.knowledge-overrides.v1",
    nodes: {
      "habit:gym": { label: "Lifting", note: "Mornings only." },
      "place:club": { deleted: true },
      "course:econ1115": { hidden: true },
      "person:priya": { mergeInto: "person:self" },
    },
    edges: { "goal:finish-resume>habit:gym:said-together": { deleted: true } },
  }));
  for (let i = 0; i < 2; i++) {
    const g = build(dirs);
    assert.equal(node(g, "habit:gym").label, "Lifting");
    assert.equal(node(g, "habit:gym").note, "Mornings only.");
    assert.ok(!node(g, "place:club") && !g.edges.some((e) => e.to === "place:club" || e.from === "place:club"));
    assert.equal(node(g, "course:econ1115").hidden, true);
    assert.ok(!node(g, "person:priya"));
    assert.ok(edge(g, "person:self", "course:econ1115", "said-together"), "a merged node's edges move to the target");
    assert.ok(!edge(g, "goal:finish-resume", "habit:gym", "said-together"));
    assert.ok(g.overrides.applied >= 5);
  }
});

test("cli: --json prints the graph and writes nothing; build writes knowledge-graph.json", () => {
  const dirs = home();
  const env = { ...process.env, ORION_WORKSPACE_DIR: dirs.workspaceDir, ORION_CONTROLLED_DIR: dirs.controlledDir,
    ORION_KNOWLEDGE_NOW: NOW.toISOString(), ORION_KNOWLEDGE_NO_CALENDAR: "1" };
  const bin = join(import.meta.dirname, "../scripts/orion-knowledge");
  const printed = spawnSync(process.execPath, [bin, "--json"], { env, encoding: "utf8" });
  assert.equal(printed.status, 0, printed.stderr);
  assert.equal(JSON.parse(printed.stdout).schema, "orion.knowledge-graph.v1");
  assert.ok(!existsSync(join(dirs.controlledDir, "knowledge-graph.json")));
  const written = spawnSync(process.execPath, [bin], { env, encoding: "utf8" });
  assert.equal(written.status, 0, written.stderr);
  assert.match(written.stdout, /nodes/);
  const file = JSON.parse(readFileSync(join(dirs.controlledDir, "knowledge-graph.json"), "utf8"));
  assert.equal(file.nodes.length, JSON.parse(printed.stdout).nodes.length);
});
