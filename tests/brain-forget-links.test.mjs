// Wave 6 (2026-11-01): orion-brain forget / links / profile over a temp vault, workspace and controlled dir.
// Gate run-1101003318: kno-forget-v/c deleted nothing, kno-connections-c read a note body, per-who-am-i-c led with trivia.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { entryMatches, keyStems } from "../scripts/lib/brain/forget.mjs";
import { buildProfile } from "../scripts/lib/brain/profile.mjs";

const BRAIN = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "orion-brain");

const NICK = `---
title: Nick
type: person
---

# Nick

## Observations
- [identity] Nick, a student in London
- [priorities] Classes → gym → study

## Relations
- trains_at [[Gym]]

## Learned
- [fact] Frozen (2026-10-25)
- [fact] Nick's goal is to introduce Carol to something. (2026-10-25)
- [fact] DS lab partner is Priya (2026-10-16)

## Learned
- [fact] Nick takes creatine every morning at 8 (2026-10-16)

## Learned
- [fact] Nick takes creatine every morning at 8 (2026-10-16)
`;
const COURSE = `---
title: CS3000
type: course
---

# CS3000

- [instructor] Ada Lovelace — ada@example.org
- [sessions] Lectures twice a week, with a lab ([[CS3001]]).

## Relations
- held_at [[Main Hall]]
- has_assessment [[CS3000 Midterm]]
`;
const LAB = `---
title: CS3001
type: course
---

## Relations
- lab_for [[CS3000]]
`;
const EXAM = `---
title: CS3000 Midterm
type: assessment
---

The mid-term exam.

## Relations
- part_of [[CS3000]]
`;

function world() {
  const root = mkdtempSync(join(tmpdir(), "brain-forget-"));
  const vault = join(root, "vault"); const ws = join(root, "ws"); const ctl = join(root, "ctl");
  mkdirSync(join(vault, "20 Areas", "Me"), { recursive: true });
  mkdirSync(join(vault, "Courses"), { recursive: true });
  mkdirSync(join(ws, "memory"), { recursive: true }); mkdirSync(ctl, { recursive: true });
  writeFileSync(join(vault, "20 Areas", "Me", "Nick.md"), NICK);
  writeFileSync(join(vault, "Courses", "CS3000.md"), COURSE);
  writeFileSync(join(vault, "Courses", "CS3001.md"), LAB);
  writeFileSync(join(vault, "Courses", "CS3000 Midterm.md"), EXAM);
  writeFileSync(join(ws, "USER.md"), "# USER\n\nprose about frozen that is not an entry\n\n- 2026-10-31 — Preference: Nick likes gym in the evening.\n");
  writeFileSync(join(ws, "memory", "2026-10-25.md"), "# 2026-10-25\n\n## Noted\n\n- 09:31 PM — talked about frozen being a good movie\n- 09:40 PM — finished the lab\n");
  const run = (...args) => {
    const r = spawnSync(process.execPath, [BRAIN, ...args], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: root, ORION_BRAIN_VAULT: vault, ORION_WORKSPACE_DIR: ws, ORION_CONTROLLED_DIR: ctl } });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(r.stdout);
  };
  return { root, vault, ws, ctl, run, nick: () => readFileSync(join(vault, "20 Areas", "Me", "Nick.md"), "utf8") };
}

test("key words drop filler and stem, so 'introducing' finds 'introduce'", () => {
  assert.deepEqual(keyStems("the one about introducing carol to something"), ["introduc", "carol"]);
  assert.deepEqual(keyStems("Saved: Frozen"), ["frozen"]);
  assert.ok(entryMatches("Nick's goal is to introduce Carol to something.", "introducing carol"));
  assert.ok(!entryMatches("DS lab partner is Priya", "carol"));
  assert.ok(!entryMatches("anything", "the stuff you saved"), "a phrase with no content words matches nothing");
});

test("forget finds saved entries in the vault and the journal, never prose", () => {
  const w = world();
  const found = w.run("forget", "frozen").matches;
  assert.deepEqual(found.map((m) => m.text).sort(), ["Frozen", "talked about frozen being a good movie"]);
  assert.ok(found.every((m) => /^[0-9a-f]{10}$/.test(m.id)));
  assert.ok(!found.some((m) => /prose/.test(m.text)));
});

test("identical duplicate lines are one entry with copies, and go together", () => {
  const w = world();
  const [m] = w.run("forget", "creatine").matches;
  assert.equal(m.copies, 2);
  const out = w.run("forget", "--apply", m.id);
  assert.equal(out.archived[0].copies, 2);
  assert.ok(!/creatine/.test(w.nick()));
});

test("apply archives exactly the named entries; everything else is unchanged; restore puts it back", () => {
  const w = world();
  const before = w.nick();
  const [carol] = w.run("forget", "introducing carol").matches;
  const out = w.run("forget", "--apply", carol.id);
  assert.deepEqual(out.archived.map((a) => a.text), ["Nick's goal is to introduce Carol to something."]);
  assert.deepEqual(out.missing, []);
  const after = w.nick();
  assert.ok(!/Carol/.test(after));
  assert.equal(after.split("\n").length, before.split("\n").length - 1);
  assert.ok(/Priya/.test(after) && /Frozen/.test(after));
  const archive = readFileSync(join(w.ctl, "memory-archive.jsonl"), "utf8");
  assert.match(archive, /introduce Carol/);
  assert.deepEqual(w.run("forget", "--apply", carol.id).archived, [], "already gone: nothing more to archive");
  const back = w.run("forget", "--restore", carol.id);
  assert.equal(back.restored.length, 1);
  assert.equal(w.nick(), before);
});

test("forget refuses ids that are not ids", () => {
  const w = world();
  const r = spawnSync(process.execPath, [BRAIN, "forget", "--apply", "../../etc"], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: w.root, ORION_BRAIN_VAULT: w.vault, ORION_WORKSPACE_DIR: w.ws, ORION_CONTROLLED_DIR: w.ctl } });
  assert.equal(r.status, 2);
});

test("links reads relations, role-named people and backlinks, not the note body", () => {
  const w = world();
  writeFileSync(join(w.ctl, "knowledge-graph.json"), JSON.stringify({
    nodes: [{ id: "person:self", type: "person", label: "Nick", facts: [] }, { id: "course:cs3000", type: "course", label: "CS3000", facts: [] }, { id: "goal:cs3000-problem-set", type: "goal", label: "CS3000 problem set", facts: [{ text: "Due Fri" }] }],
    edges: [{ from: "person:self", to: "course:cs3000", kind: "takes" }, { from: "goal:cs3000-problem-set", to: "course:cs3000", kind: "deadline-for" }],
  }));
  const out = w.run("links", "cs 3000");
  assert.equal(out.found, true);
  assert.equal(out.title, "CS3000");
  const by = Object.fromEntries(out.links.map((l) => [l.label, l]));
  assert.equal(by["Main Hall"].kind, "held_at");
  assert.equal(by["CS3000 Midterm"].type, "assessment");
  assert.equal(by["Ada Lovelace"].kind, "instructor");
  assert.deepEqual([by["CS3001"].kind, by["CS3001"].dir], ["lab_for", "in"]);
  assert.equal(by["Nick"].dir, "in");
  assert.equal(by["CS3000 problem set"].kind, "deadline-for");
  assert.ok(!out.links.some((l) => /Lectures twice/.test(l.label)));
});

// Gate run-1101020721 kno-connections-v: a subject that is no node ("the cs midterm") was a dead end. It now falls back to the
// nearest node, the class the deadline belongs to, or a fuzzy title, and says which one it used.
const BRIEF = `---
title: Pitch deck brief
type: note
---

Deadline for [[MKTG9100]].
`;
const MKTG = `---
title: MKTG9100
type: course
---

## Relations
- held_at [[West Wing]]
`;
test("links falls back from a missing subject to the class whose deadline it is, and says so", () => {
  const w = world();
  writeFileSync(join(w.vault, "Courses", "Pitch deck brief.md"), BRIEF);
  writeFileSync(join(w.vault, "Courses", "MKTG9100.md"), MKTG);
  for (const said of ["cs midterm", "my cs mid-term exam", "the cs midterm thing"]) {
    const out = w.run("links", said);
    assert.equal(out.found, true, said);
    assert.equal(out.title, "CS3000", said);
    assert.deepEqual(out.fallback, { from: said, via: "CS3000 Midterm", why: "class" }, said);
    assert.ok(out.links.some((l) => l.label === "Main Hall"), said);
  }
  const mk = w.run("links", "mktg deadline");
  assert.equal(mk.title, "MKTG9100");
  assert.equal(mk.fallback.via, "Pitch deck brief");
});

test("a class note that itself holds every word is the fallback, never its lab (live vault: cs midterm went to CS2101)", () => {
  const w = world();
  const out = w.run("links", "cs lectures");
  assert.equal(out.title, "CS3000");
  assert.equal(out.fallback.via, "CS3000");
});

test("links falls back to a fuzzy title when no deadline matches, and never to a guess", () => {
  const w = world();
  const out = w.run("links", "cs3001 lab stuff");
  assert.equal(out.title, "CS3001");
  assert.equal(out.fallback.why, "title");
  assert.equal(w.run("links", "physics midterm").found, false);
});

test("links says when nothing by that name exists", () => {
  const w = world();
  assert.deepEqual(w.run("links", "quantum basket weaving"), { subject: "quantum basket weaving", found: false, facts: [], links: [] });
});

test("profile leads with the standing records, trivia and learned lines kept apart", () => {
  const graph = {
    nodes: [
      { id: "person:self", type: "person", label: "Nick", subtitle: "Nick Madaio", facts: [] },
      { id: "course:cs3000", type: "course", label: "CS3000", facts: [] },
      { id: "place:london", type: "place", label: "London", facts: [] },
      { id: "place:office", type: "place", label: "Office", facts: [{ text: "20 min commute" }] },
      { id: "project:atlas", type: "project", label: "Atlas", facts: [] },
      { id: "preference:planning-priorities", type: "preference", label: "Planning priorities", facts: [{ text: "Planning priorities, highest first: classes → gym → study" }] },
      { id: "routine:sleep", type: "routine", label: "Sleep", facts: [{ text: "Falls asleep around 1:00 AM" }] },
    ],
    edges: [
      { from: "person:self", to: "course:cs3000", kind: "takes" }, { from: "person:self", to: "place:london", kind: "lives-in" },
      { from: "person:self", to: "place:office", kind: "commutes-to" }, { from: "person:self", to: "project:atlas", kind: "builds" },
    ],
  };
  const lifeConfig = { minimums: { "side project": 60 }, anchors: [{ kind: "gym", minutes: 90, days: [1, 2, 3, 4, 5, 6, 7], rank: "must" }] };
  const p = buildProfile({ graph, lifeConfig, nickNote: NICK });
  assert.equal(p.name, "Nick Madaio");
  assert.deepEqual(p.classes, ["CS3000"]);
  assert.equal(p.gym, "90 min every day (a must, never dropped)");
  assert.equal(p.sideProject, "at least 1 hour a day");
  assert.equal(p.priorities, "classes → gym → study");
  assert.equal(p.home, "London");
  assert.equal(p.commute, "20 min commute to Office");
  assert.deepEqual(p.builds, ["Atlas"]);
  assert.deepEqual(p.trivia, ["Falls asleep around 1:00 AM"]);
  assert.ok(p.learned.includes("DS lab partner is Priya"));
  assert.equal(p.learned.filter((l) => /creatine/.test(l)).length, 1, "duplicates once");
});

test("profile with no records invents nothing", () => {
  const p = buildProfile({});
  assert.deepEqual(p.classes, []);
  assert.equal(p.gym, "");
  assert.equal(p.home, "");
});

// REV6 item 5: forget, put back, forget the same line again: "put it back" said "That was already back." while it stayed archived.
test("a line forgotten a second time after a restore comes back on the second restore", () => {
  const w = world();
  const before = w.nick();
  const [priya] = w.run("forget", "priya").matches;
  assert.equal(w.run("forget", "--apply", priya.id).archived.length, 1);
  assert.equal(w.run("forget", "--restore", priya.id).restored.length, 1);
  assert.equal(w.nick(), before);
  assert.equal(w.run("forget", "--apply", priya.id).archived.length, 1);
  assert.ok(!/Priya/.test(w.nick()));
  const again = w.run("forget", "--restore", priya.id);
  assert.equal(again.restored.length, 1);
  assert.equal(w.nick(), before);
  assert.equal(w.run("forget", "--restore", priya.id).restored.length, 0, "now it really is back: nothing left to restore");
  assert.equal(w.nick(), before);
});
