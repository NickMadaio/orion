// ORION's own notes (wave 12 L1): answers folded into his Nick note, tagged #orion, which ORION may edit or unlearn.
// Nick's and system entries are refused.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendLearned, foldAnswer, isOwn, learnedLine, learnIntoNote, nickNotePath, ownEntries, unlearnOwn, editOwn } from "../scripts/lib/brain/questions-notes.mjs";
import { listEntries } from "../scripts/lib/brain/forget.mjs";

const NOTE = `---
title: Nick
---

## Observations
- [identity] Nick, a student

## Learned
- [fact] DS lab partner is Priya (2026-10-16)

## Relations
- lives_in [[London]]
`;

function dirs() {
  const root = mkdtempSync(join(tmpdir(), "own-notes-"));
  const vaultDir = join(root, "vault");
  mkdirSync(join(vaultDir, "20 Areas/Me"), { recursive: true });
  writeFileSync(nickNotePath(vaultDir), NOTE);
  return { vaultDir, workspaceDir: join(root, "ws"), controlledDir: join(root, "ctl") };
}

test("learnedLine tags ORION's own lines; isOwn reads the tag", () => {
  assert.equal(learnedLine("answer", "Who is Sam? → gym buddy", "2026-11-02", { own: true }), "- [answer] Who is Sam? → gym buddy #orion (2026-11-02)");
  assert.equal(learnedLine("fact", "x", "2026-11-02"), "- [fact] x (2026-11-02)");
  assert.ok(isOwn("- [answer] a #orion (2026-11-02)"));
  assert.ok(!isOwn("- [fact] DS lab partner is Priya (2026-10-16)"));
});

test("appendLearned reuses the one Learned header, even when Relations follows it; adds one only when there is none", () => {
  const out = appendLearned(NOTE, "- [answer] q → a #orion (2026-11-02)");
  assert.equal((out.match(/^## Learned/gm) ?? []).length, 1);
  assert.match(out, /## Learned\n- \[fact\] DS lab partner is Priya \(2026-10-16\)\n- \[answer\] q → a #orion \(2026-11-02\)\n\n## Relations/);
  const tail = appendLearned("## Learned\n- [fact] a (2026-10-01)\n", "- [answer] b #orion (2026-11-02)");
  assert.equal(tail, "## Learned\n- [fact] a (2026-10-01)\n- [answer] b #orion (2026-11-02)\n");
  const none = appendLearned("# Gym\n\n## Relations\n- about [[Nick]]\n", "- [fact] c (2026-11-02)");
  assert.equal(none, "# Gym\n\n## Relations\n- about [[Nick]]\n\n## Learned\n- [fact] c (2026-11-02)\n");
  // the live Nick note's shape: several headers already; the line goes to the last one and no new header appears
  const many = appendLearned("## Learned\n- [fact] x (2026-10-16)\n\n## Learned\n\n## Learned\n- [fact] y (2026-10-25)\n", "- [fact] z (2026-11-02)");
  assert.equal((many.match(/^## Learned/gm) ?? []).length, 3);
  assert.match(many, /- \[fact\] y \(2026-10-25\)\n- \[fact\] z \(2026-11-02\)\n$/);
});

test("learnIntoNote: a second learn into the same note reuses its header (found on disk by title or file name)", () => {
  const d = dirs();
  learnIntoNote(d.vaultDir, "Nick", "- [fact] one (2026-11-02)");
  learnIntoNote(d.vaultDir, "nick", "- [fact] two (2026-11-02)");
  const text = readFileSync(nickNotePath(d.vaultDir), "utf8");
  assert.equal((text.match(/^## Learned/gm) ?? []).length, 1);
  assert.match(text, /Priya \(2026-10-16\)\n- \[fact\] one \(2026-11-02\)\n- \[fact\] two \(2026-11-02\)\n\n## Relations/);
  mkdirSync(join(d.vaultDir, "20 Areas/Learned"), { recursive: true });
  writeFileSync(join(d.vaultDir, "20 Areas/Learned/Gym.md"), "## Learned\n- [fact] a (2026-10-01)\n\n## Relations\n- about [[Nick]]\n");
  learnIntoNote(d.vaultDir, "Gym", "- [fact] b (2026-11-02)");
  learnIntoNote(d.vaultDir, "Gym", "- [fact] c (2026-11-02)");
  assert.equal(readFileSync(join(d.vaultDir, "20 Areas/Learned/Gym.md"), "utf8"), "## Learned\n- [fact] a (2026-10-01)\n- [fact] b (2026-11-02)\n- [fact] c (2026-11-02)\n\n## Relations\n- about [[Nick]]\n");
  assert.equal(learnIntoNote(d.vaultDir, "Nobody", "- x"), null);
});

test("foldAnswer writes the fact into his Nick note, where forget/recall find it", () => {
  const d = dirs();
  const out = foldAnswer({ vaultDir: d.vaultDir, fact: "Who is Sam? → my gym buddy", date: "2026-11-02" });
  assert.equal(out.written, true);
  const text = readFileSync(nickNotePath(d.vaultDir), "utf8");
  assert.match(text, /- \[answer\] Who is Sam\? → my gym buddy #orion \(2026-11-02\)/);
  assert.ok(listEntries(d).some((e) => /gym buddy/.test(e.text)));
});

test("foldAnswer creates the Nick note when the vault has none", () => {
  const root = mkdtempSync(join(tmpdir(), "own-notes-new-"));
  const out = foldAnswer({ vaultDir: root, fact: "q → a", date: "2026-11-02" });
  assert.equal(out.written, true);
  assert.ok(existsSync(nickNotePath(root)));
  assert.match(readFileSync(nickNotePath(root), "utf8"), /title: Nick[\s\S]*## Learned\n- \[answer\] q → a #orion/);
});

test("unlearn: ORION's own entry is archived; Nick's is refused and stays", () => {
  const d = dirs();
  foldAnswer({ vaultDir: d.vaultDir, fact: "Who is Sam? → my gym buddy", date: "2026-11-02" });
  const mine = ownEntries(d);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].text, "Who is Sam? → my gym buddy");
  const nicks = listEntries(d).find((e) => /Priya/.test(e.text));
  const out = unlearnOwn(d, [mine[0].id, nicks.id, "0000000000"]);
  assert.deepEqual(out.archived.map((a) => a.id), [mine[0].id]);
  assert.deepEqual(out.refused, [nicks.id]);
  assert.deepEqual(out.missing, ["0000000000"]);
  const text = readFileSync(nickNotePath(d.vaultDir), "utf8");
  assert.doesNotMatch(text, /gym buddy/);
  assert.match(text, /Priya/);
  assert.match(readFileSync(join(d.controlledDir, "memory-archive.jsonl"), "utf8"), /gym buddy/);
});

test("edit: ORION's own entry is rewritten in place (old line archived); Nick's is refused", () => {
  const d = dirs();
  foldAnswer({ vaultDir: d.vaultDir, fact: "Who is Sam? → my gym buddy", date: "2026-11-01" });
  const [mine] = ownEntries(d);
  const out = editOwn(d, mine.id, "Sam is his gym buddy on Tuesdays", new Date(2026, 10, 2, 12));
  assert.equal(out.edited.text, "Sam is his gym buddy on Tuesdays");
  const text = readFileSync(nickNotePath(d.vaultDir), "utf8");
  assert.match(text, /- \[answer\] Sam is his gym buddy on Tuesdays #orion \(2026-11-02\)/);
  assert.doesNotMatch(text, /→ my gym buddy/);
  assert.match(readFileSync(join(d.controlledDir, "memory-archive.jsonl"), "utf8"), /→ my gym buddy/);
  const nicks = listEntries(d).find((e) => /Priya/.test(e.text));
  assert.throws(() => editOwn(d, nicks.id, "Priya is someone else"), /not one of ORION's own/);
  assert.throws(() => editOwn(d, ownEntries(d)[0].id, "   "), /empty/);
});
