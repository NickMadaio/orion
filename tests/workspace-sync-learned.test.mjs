// Wave 12 (2026-11-02): `orion_v2_workspace_sync.sh --apply` copied the repo's USER.md over the live one, which would have wiped
// every line ORION learned (orion-remember --user appends dated one-line bullets; orion-brain-style notes keep a "## Learned"
// section). The sync now carries those lines across, and a live copy that differs only by them is in step, not drift.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { learnedLines, mergeLearned, withoutLearned } from "../scripts/lib/brain/consolidate-learned.mjs";

const SYNC = join(dirname(fileURLToPath(import.meta.url)), "..", "scripts", "orion_v2_workspace_sync.sh");
const FILES = ["AGENTS.md", "SOUL.md", "SELF.md", "USER.md", "PLAYBOOK.md", "MEMORY.md", "SCHEDULING.md"];

const TEMPLATE = `# Nick

- Name: Nick

## Durable personal context

- 2026-09-29 — **Times are 12-hour: "8:11 PM", never "20:11", and never both in
  one answer.** Nick is American.

- 2026-09-01 — For weather use the place field.

Store only user-stated, durable, useful facts.
`;
const LEARNED = ["- 2026-11-01 — Preference: Nick likes gym in the evening.", "- 2026-11-02 — Rule: Nick calls it CS2101, not \"the lab\"."];

function dirs({ src = {}, live = {} } = {}) {
  const root = mkdtempSync(join(tmpdir(), "ws-sync-"));
  const s = join(root, "src"); const l = join(root, "live");
  mkdirSync(s); mkdirSync(l);
  for (const f of FILES) { writeFileSync(join(s, f), src[f] ?? `# ${f}\n`); writeFileSync(join(l, f), live[f] ?? src[f] ?? `# ${f}\n`); }
  const run = (...args) => spawnSync("bash", [SYNC, ...args], { encoding: "utf8", env: { PATH: process.env.PATH, HOME: root, ORION_WORKSPACE: l, ORION_WORKSPACE_SRC: s } });
  return { root, s, l, run };
}

test("learnedLines: appended dated one-liners and ## Learned entries the repo does not have", () => {
  const live = `${TEMPLATE}${LEARNED.join("\n")}\n`;
  assert.deepEqual(learnedLines(TEMPLATE, live).bullets, LEARNED);
  // A multi-line template entry is never mistaken for a learned line, even when the repo reworded its first line.
  const reworded = TEMPLATE.replace("**Times are 12-hour", "**Times are always 12-hour");
  assert.deepEqual(learnedLines(reworded, TEMPLATE).bullets, []);
});

test("a reworded single-line template entry is not carried as learned when it sits inside the template body", () => {
  const reworded = TEMPLATE.replace("For weather use the place field.", "For weather use `place`.");
  assert.deepEqual(learnedLines(reworded, TEMPLATE).bullets, []);
});

test("mergeLearned keeps the new template and appends what was learned, once", () => {
  const live = `${TEMPLATE}${LEARNED.join("\n")}\n`;
  const repo = TEMPLATE.replace("- Name: Nick", "- Name: Nick Madaio");
  const merged = mergeLearned(repo, live);
  assert.match(merged, /Name: Nick Madaio/);
  for (const l of LEARNED) assert.equal(merged.split("\n").filter((x) => x === l).length, 1);
  // Already in the repo: not duplicated.
  const repoHas = `${repo}${LEARNED[0]}\n`;
  assert.equal(mergeLearned(repoHas, live).split("\n").filter((x) => x === LEARNED[0]).length, 1);
  assert.equal(withoutLearned(TEMPLATE, live).trimEnd(), TEMPLATE.trimEnd());
});

test("## Learned section entries survive a merge, under one header", () => {
  const repo = "# Memory\n\nrules\n";
  const live = "# Memory\n\nrules\n\n## Learned\n- [fact] lab partner is Priya (2026-10-16)\n\n## Learned\n- [rule] naps at least 75 min (2026-10-01)\n";
  const merged = mergeLearned(repo, live);
  assert.equal(merged.match(/^## Learned$/gm)?.length, 1);
  assert.match(merged, /lab partner is Priya/);
  assert.match(merged, /naps at least 75 min/);
});

test("report: a live copy that differs only by learned lines is in step", () => {
  const d = dirs({ src: { "USER.md": TEMPLATE }, live: { "USER.md": `${TEMPLATE}${LEARNED.join("\n")}\n` } });
  const out = d.run();
  assert.equal(out.status, 0, out.stdout + out.stderr);
  assert.match(out.stdout, /in step\s+USER\.md\s+\(\+2 learned/);
});

test("--apply installs the new template and keeps every learned line, with a backup", () => {
  const live = `${TEMPLATE}${LEARNED.join("\n")}\n`;
  const repo = TEMPLATE.replace("- Name: Nick", "- Name: Nick Madaio");
  const d = dirs({ src: { "USER.md": repo, "MEMORY.md": "# Memory\nnew rules\n" }, live: { "USER.md": live, "MEMORY.md": "# Memory\nold\n\n## Learned\n- [fact] keep me (2026-10-16)\n" } });
  assert.equal(d.run().status, 1);   // drift reported
  const out = d.run("--apply");
  assert.equal(out.status, 0, out.stdout + out.stderr);
  const user = readFileSync(join(d.l, "USER.md"), "utf8");
  assert.match(user, /Name: Nick Madaio/);
  for (const l of LEARNED) assert.ok(user.includes(l), `lost: ${l}`);
  const memory = readFileSync(join(d.l, "MEMORY.md"), "utf8");
  assert.match(memory, /new rules/);
  assert.match(memory, /keep me/);
  const backup = readdirSync(d.l).find((n) => n.startsWith(".backup-"));
  assert.ok(backup && existsSync(join(d.l, backup, "USER.md")));
  assert.equal(readFileSync(join(d.l, backup, "USER.md"), "utf8"), live);
  // And now it is in step, learned lines and all.
  const again = d.run();
  assert.equal(again.status, 0, again.stdout);
  assert.match(again.stdout, /in step\s+USER\.md\s+\(\+2 learned/);
});
