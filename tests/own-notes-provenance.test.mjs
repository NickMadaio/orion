// Wave 12 fixer (2026-11-02). Two review findings on ORION's own notes:
//  1. Nick's ANSWER to one of ORION's questions was written with ORION's tag (#orion), so ORION could edit or unlearn Nick's own
//     words. Answers now carry #answer: read and recalled like any fact, never editable or removable through the own-notes paths.
//  2. editOwn rewrote a USER.md or journal line in the vault's shape, and the line then vanished from listing. Each store's line
//     keeps its own shape; a round trip (edit, list, unlearn) is proven for each.
// Temp dirs only.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ANSWER_TAG, editOwn, foldAnswer, isOwn, learnedLine, nickNotePath, ownEntries, unlearnOwn } from "../scripts/lib/brain/questions-notes.mjs";
import { archiveEntries, findEntries, listEntries } from "../scripts/lib/brain/forget.mjs";

function dirs() {
  const root = mkdtempSync(join(tmpdir(), "own-prov-"));
  const vaultDir = join(root, "vault");
  const workspaceDir = join(root, "ws");
  mkdirSync(join(vaultDir, "20 Areas/Me"), { recursive: true });
  mkdirSync(join(workspaceDir, "memory"), { recursive: true });
  writeFileSync(nickNotePath(vaultDir), "---\ntitle: Nick\n---\n\n## Learned\n- [fact] DS lab partner is Priya (2026-10-16)\n");
  return { vaultDir, workspaceDir, controlledDir: join(root, "ctl") };
}

test("an answer is tagged #answer, not ORION's #orion", () => {
  const d = dirs();
  const out = foldAnswer({ vaultDir: d.vaultDir, fact: "Who is Sam? → my gym buddy", date: "2026-11-02" });
  assert.equal(ANSWER_TAG, "#answer");
  assert.equal(out.line, "- [answer] Who is Sam? → my gym buddy #answer (2026-11-02)");
  assert.doesNotMatch(readFileSync(nickNotePath(d.vaultDir), "utf8"), /#orion/);
  assert.equal(isOwn(out.line), false);
  assert.equal(learnedLine("answer", "q → a", "2026-11-02", { answer: true }), "- [answer] q → a #answer (2026-11-02)");
});

test("an answer is listed and found like any fact (tag hidden), but never one of ORION's own", () => {
  const d = dirs();
  foldAnswer({ vaultDir: d.vaultDir, fact: "Who is Sam? → my gym buddy", date: "2026-11-02" });
  const entry = listEntries(d).find((e) => /gym buddy/.test(e.text));
  assert.equal(entry.text, "Who is Sam? → my gym buddy");
  assert.equal(findEntries(d, "sam gym").length, 1);
  assert.deepEqual(ownEntries(d), []);
});

test("ORION cannot unlearn or edit Nick's answer; Nick's guarded forget still can", () => {
  const d = dirs();
  foldAnswer({ vaultDir: d.vaultDir, fact: "Who is Sam? → my gym buddy", date: "2026-11-02" });
  const { id } = listEntries(d).find((e) => /gym buddy/.test(e.text));
  assert.deepEqual(unlearnOwn(d, [id]).refused, [id]);
  assert.throws(() => editOwn(d, id, "Sam is nobody"), /not one of ORION's own/);
  assert.match(readFileSync(nickNotePath(d.vaultDir), "utf8"), /→ my gym buddy #answer/);
  assert.deepEqual(archiveEntries(d, [id]).archived.map((a) => a.id), [id]);   // knowledge-run.ts's path, his own words
  assert.doesNotMatch(readFileSync(nickNotePath(d.vaultDir), "utf8"), /gym buddy/);
});

test("an answer written before the fix (tagged #orion) is still Nick's, not ORION's", () => {
  const d = dirs();
  writeFileSync(nickNotePath(d.vaultDir), "## Learned\n- [answer] Who is Sam? → gym buddy #orion (2026-11-01)\n- [guess] lifts tuesdays #orion (2026-11-01)\n");
  assert.equal(isOwn("- [answer] Who is Sam? → gym buddy #orion (2026-11-01)"), false);
  assert.deepEqual(ownEntries(d).map((e) => e.text), ["lifts tuesdays"]);
  const { id } = listEntries(d).find((e) => /gym buddy/.test(e.text));
  assert.deepEqual(unlearnOwn(d, [id]).refused, [id]);
});

const roundTrip = (d, store, file, before, wantShape) => {
  const path = store === "vault" ? join(d.vaultDir, file) : join(d.workspaceDir, file);
  const [mine] = ownEntries(d).filter((e) => e.file === file);
  assert.ok(mine, `${file}: the own line is listed`);
  const out = editOwn(d, mine.id, "the new wording", new Date(2026, 10, 2, 12));
  const text = readFileSync(path, "utf8");
  assert.doesNotMatch(text, new RegExp(before));
  assert.match(text, wantShape);
  const listed = ownEntries(d).find((e) => e.id === out.edited.id);
  assert.ok(listed, `${file}: the edited line is listed again under the id edit returned`);
  assert.match(listed.text, /^(?:Rule: )?the new wording$/);
  assert.deepEqual(unlearnOwn(d, [out.edited.id]).archived.map((a) => a.id), [out.edited.id]);
  assert.doesNotMatch(readFileSync(path, "utf8"), /the new wording/);
};

test("round trip in the vault: edit keeps the bullet shape, then list, then unlearn", () => {
  const d = dirs();
  writeFileSync(nickNotePath(d.vaultDir), "## Learned\n- [guess] probably lifts tuesdays #orion (2026-11-01)\n");
  roundTrip(d, "vault", "20 Areas/Me/Nick.md", "probably lifts", /^- \[guess\] the new wording #orion \(2026-11-02\)$/m);
});

test("round trip in USER.md: edit keeps '- <date> — …', then list, then unlearn", () => {
  const d = dirs();
  writeFileSync(join(d.workspaceDir, "USER.md"), "# USER\n- 2026-10-31 — stop being so formal\n- 2026-11-01 — Rule: probably prefers short replies #orion\n");
  roundTrip(d, "workspace", "USER.md", "probably prefers", /^- 2026-11-02 — Rule: the new wording #orion$/m);
  assert.match(readFileSync(join(d.workspaceDir, "USER.md"), "utf8"), /stop being so formal/);
});

test("round trip in the journal: edit keeps '- <time> — [auto] …', then list, then unlearn", () => {
  const d = dirs();
  writeFileSync(join(d.workspaceDir, "memory", "2026-11-01.md"), "# 2026-11-01\n\n- 09:31 PM — [auto] seems tired after labs #orion\n");
  roundTrip(d, "workspace", "memory/2026-11-01.md", "seems tired", /^- 09:31 PM — \[auto\] the new wording #orion$/m);
});
